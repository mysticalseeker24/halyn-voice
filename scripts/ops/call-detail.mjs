// Halyn's view of one call from the deployed Console API (console session; demo code from .env, never printed).
// Usage (repo root): node scripts/ops/call-detail.mjs <run_id>
process.loadEnvFile('.env');
const API = 'https://halyn-api.halyn-api.workers.dev';
const headers = { 'content-type': 'application/json', origin: 'https://halyn-voice.vercel.app' };
const s = await fetch(`${API}/web/session`, {
  method: 'POST',
  headers: { ...headers, 'x-demo-code': process.env.DEMO_ACCESS_CODE ?? '' },
  body: JSON.stringify({ kind: 'console' }),
});
const { token } = await s.json();
const r = await fetch(`${API}/web/calls/${process.argv[2]}`, {
  headers: { ...headers, authorization: `Bearer ${token}` },
});
const body = await r.json();
console.log('status', r.status);
const strip = (o) => JSON.stringify(o, (k, v) => (k === 'transcript' ? `[${String(v).length} chars]` : v), 1);
console.log(
  strip(body)
    .replace(/\+?\d{10,13}/g, (m) => `••••${m.slice(-4)}`)
    .slice(0, 4000),
);
