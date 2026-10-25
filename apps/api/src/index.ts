import { Hono } from 'hono';

export { HubDO } from './hub/hub-do';

const app = new Hono<{ Bindings: Env }>();

// Liveness only. Tools, web routes and /ws arrive in PROMPTS.md Step 5 onwards.
app.get('/health', (c) => c.json({ ok: true, service: 'halyn-api' }));

export default app;
