import { Hono } from 'hono';

// The mock bank ("Aero Core"). Every write will require a valid Halyn grant (PROMPTS.md Step 6).
const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true, service: 'aero-core' }));

export default app;
