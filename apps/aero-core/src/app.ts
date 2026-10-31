import { type Clock, coreEndpoints, newId, type Rng } from '@halyn/shared';
import { Hono } from 'hono';
import { execute } from './core/execute';
import { ensureJudgeAccount } from './seed/judge';
import { createDb } from './db/client';
import { requireCoreEnv } from './env';
import { readParams } from './grant/params';
import { requireGrant } from './grant/require-grant';
import { notFound, onError } from './http/errors';
import { requestLog } from './http/request-log';
import { cryptoRng, systemClock } from './platform';

// Aero Core, the mock bank: one route per endpoint in CORE_ROUTES (packages/shared/src/core.ts, docs/API.md). Every
// route — reads included — runs: config → x-halyn-grant (requireGrant) → the action for the grant's customer, with the
// jti recorded in the same D1 batch as the effect. No grant, no action (invariant 1); any error, no write (invariant 2).

export interface AppDeps {
  clock: Clock;
  rng: Rng;
}

export function createApp(deps: AppDeps = { clock: systemClock, rng: cryptoRng }) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requestLog());
  app.onError(onError);
  app.notFound(notFound);

  app.get('/health', (c) => c.json({ ok: true, service: 'aero-core' }));

  // Hono serves HEAD with the GET handler: an empty reply that would still use up a read grant. Refuse it first.
  app.use('/core/*', async (c, next) => {
    if (c.req.raw.method !== 'HEAD') return next();
    return c.json({ error: { code: 'E_BAD_REQUEST', message: 'HEAD is not supported on core routes' } }, 405);
  });

  for (const endpoint of coreEndpoints()) {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const env = requireCoreEnv(c.env);
      const nowMs = deps.clock.nowMs();
      const grant = await requireGrant({
        token: c.req.header('x-halyn-grant'),
        params: () => readParams(c.req.raw),
        actions: endpoint.actions,
        jwks: env.jwks,
        tenant: env.tenant,
        nowMs,
      });
      await ensureJudgeAccount(env.db, grant.claims.tenant, grant.claims.sub);
      const body = await execute(
        {
          db: createDb(env.db),
          tenant: grant.claims.tenant,
          customer: grant.claims.sub,
          jti: grant.jti,
          requestId: grant.claims.request_id,
          action: grant.proposed.action,
          now: new Date(nowMs).toISOString(),
          newId: (prefix) => newId(prefix, deps.clock, deps.rng),
        },
        grant.proposed,
      );
      return c.json(body);
    });
  }

  return app;
}
