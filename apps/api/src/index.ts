import { TenantIdSchema } from '@halyn/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireSession } from './auth/require-session';
import { WebEnvSchema } from './env';
import { type AppDeps, defaultDeps } from './flow/context';
import type { AppEnv } from './http/app-env';
import { hubFor } from './hub/client';
import { notFound, onError } from './http/errors';
import { requestLog } from './http/request-log';
import { bolnaRoutes } from './tools/routes';
import { aeroHome } from './web/aero-home';
import {
  callDetail,
  consolePasses,
  consoleRevokePass,
  integrations,
  ledgerExport,
  listCalls,
  listPolicies,
  signalsRoute,
} from './web/console';
import { listHandoffs, resolveHandoffRoute } from './web/handoffs';
import { ledgerList, ledgerVerify } from './web/ledger';
import {
  approvalDecline,
  approvalOptions,
  approvalVerify,
  registerOptions,
  registerVerify,
} from './web/passkeys';
import { assistantTask, issuePassRoute, listPasses, passOptions, revokePassRoute } from './web/passes';
import { createSession } from './web/session-route';
import { webCallSession } from './web/web-calls';
import { stageRegion, stageRun } from './web/stage';
import { createTestRun, permissionMapRoute, testRunRoute } from './web/tests';
import { connectWebSocket, wsTicket } from './web/ws-route';

export { HubDO } from './hub/hub-do';

/**
 * The Halyn API Worker. Dependencies (clock, rng, how Bolna and Aero Core are reached) are injected so the scenario
 * runner and the tests drive the real app with a Bolna recorder and the real Aero Core in-process; production uses
 * the defaults.
 */
export function createApp(deps: AppDeps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', requestLog());
  app.onError(onError);
  app.notFound(notFound);

  // Liveness only: no secrets, no database.
  app.get('/health', (c) => c.json({ ok: true, service: 'halyn-api' }));

  // Bolna-facing (docs/API.md): source IP allowlist AND x-halyn-secret, then the six tools and the webhook.
  app.route('/', bolnaRoutes(deps));

  // The four apps. CORS for the web origins only (an allow-list from WEB_ORIGIN, never "*"); preflight answers before
  // the session check, so a browser can ask.
  app.use(
    '/web/*',
    cors({
      origin: (origin, c) => {
        const web = WebEnvSchema.safeParse(c.env);
        return web.success && web.data.WEB_ORIGIN.includes(origin) ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type', 'x-demo-code'],
      maxAge: 600,
    }),
  );
  app.post('/web/session', async (c) => {
    const res = await createSession(c);
    // Warm the tenant's Hub (its directory load from TiDB) before the first call needs it (ADR-016).
    if (res.ok)
      try {
        const tenant = TenantIdSchema.safeParse(c.env.DEFAULT_TENANT_ID);
        if (tenant.success)
          c.executionCtx.waitUntil(
            hubFor(c.env, tenant.data)
              .warm()
              .catch(() => 0),
          );
      } catch {
        // No execution context (tests calling app.request directly): nothing to warm.
      }
    return res;
  });
  app.use('/web/*', async (c, next) => (c.req.path === '/web/session' ? next() : requireSession()(c, next)));
  app.get('/web/me', (c) => c.json(c.get('session')));
  app.get('/web/aero/home', aeroHome(deps));
  app.post('/web/passkeys/register/options', registerOptions(deps));
  app.post('/web/passkeys/register/verify', registerVerify(deps));
  app.post('/web/approvals/:id/options', approvalOptions(deps));
  app.post('/web/approvals/:id/verify', approvalVerify(deps));
  app.post('/web/approvals/:id/decline', approvalDecline(deps));
  app.post('/web/passes/options', passOptions(deps));
  app.post('/web/passes', issuePassRoute(deps));
  app.get('/web/passes', listPasses(deps));
  app.delete('/web/passes/:id', revokePassRoute(deps));
  app.post('/web/assistant/tasks', assistantTask(deps));
  app.post('/web/calls/session', webCallSession(deps));
  app.get('/web/handoffs', listHandoffs(deps));
  app.post('/web/handoffs/:id/resolve', resolveHandoffRoute(deps));
  app.get('/web/ledger', ledgerList);
  app.get('/web/ledger/verify', ledgerVerify);
  app.get('/web/ledger/export', ledgerExport(deps));
  app.get('/web/calls', listCalls(deps));
  app.get('/web/calls/:id', callDetail(deps));
  app.get('/web/policies', listPolicies);
  app.get('/web/console/passes', consolePasses(deps));
  app.delete('/web/console/passes/:id', consoleRevokePass(deps));
  app.get('/web/signals', signalsRoute(deps));
  app.get('/web/integrations', integrations(deps));
  app.post('/web/stage/run/:scenario', stageRun(deps, createApp));
  app.post('/web/stage/region', stageRegion);
  app.post('/web/tests/runs', createTestRun(deps));
  app.get('/web/tests/runs/:id', testRunRoute);
  app.get('/web/tests/permission-map', permissionMapRoute);
  // The WebSocket: a one-time ticket from the session first, then the upgrade with the ticket (ADR-021).
  app.post('/web/ws-ticket', wsTicket);
  app.get('/ws', connectWebSocket);

  return app;
}

export default createApp();
