import { errorEnvelope } from '@halyn/shared';
import { Hono } from 'hono';
import { bolnaGuard } from './auth/bolna-guard';
import { requireSession } from './auth/require-session';
import type { AppEnv } from './http/app-env';
import { notFound, onError } from './http/errors';
import { requestLog } from './http/request-log';
import { createSession } from './web/session-route';
import { connectWebSocket } from './web/ws-route';

export { HubDO } from './hub/hub-do';

const app = new Hono<AppEnv>();

app.use('*', requestLog());
app.onError(onError);
app.notFound(notFound);

// Liveness only: no secrets, no database.
app.get('/health', (c) => c.json({ ok: true, service: 'halyn-api' }));

// Bolna-facing (docs/API.md): source IP allowlist AND x-halyn-secret. The tool handlers arrive in Step 7.
const notYet = () =>
  new Response(JSON.stringify(errorEnvelope('E_FAIL_CLOSED', 'Not implemented yet (PROMPTS.md Step 7)')), {
    status: 501,
    headers: { 'content-type': 'application/json' },
  });
app.use('/tools/*', bolnaGuard());
app.use('/webhooks/*', bolnaGuard());
app.post('/tools/:name', notYet);
app.post('/webhooks/bolna', notYet);

// The four apps.
app.post('/web/session', createSession);
app.use('/web/*', async (c, next) => (c.req.path === '/web/session' ? next() : requireSession()(c, next)));
app.get('/web/me', (c) => c.json(c.get('session')));
app.get('/ws', connectWebSocket);

export default app;
