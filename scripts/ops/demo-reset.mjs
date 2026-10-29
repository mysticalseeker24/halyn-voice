// Demo reset on the deployed API before a take: POST /web/stage/demo-reset (earlier calls stop counting towards
// S_CALL_BURST; nothing is deleted). Console session with the demo code from .env (never printed). Aero Core's
// balances and the frozen card reset separately: `pnpm seed:core --remote --yes` (go-ahead).
// Usage (repo root): node scripts/ops/demo-reset.mjs
process.loadEnvFile('.env');
const API = 'https://halyn-api.halyn-api.workers.dev';
const headers = { 'content-type': 'application/json', origin: 'https://halyn-voice.vercel.app' };
const s = await fetch(`${API}/web/session`, {
  method: 'POST',
  headers: { ...headers, 'x-demo-code': process.env.DEMO_ACCESS_CODE ?? '' },
  body: JSON.stringify({ kind: 'console' }),
});
const { token } = await s.json();
const r = await fetch(`${API}/web/stage/demo-reset`, {
  method: 'POST',
  headers: { ...headers, authorization: `Bearer ${token}` },
  body: '{}',
});
console.log('session', s.status, 'demo-reset', r.status, JSON.stringify(await r.json()));
