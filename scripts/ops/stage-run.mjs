// One Stage text run on the deployed API (console session with the demo code from .env; never printed).
// Usage (repo root): node scripts/ops/stage-run.mjs <scenario>
process.loadEnvFile('.env');
const API = 'https://halyn-api.halyn-api.workers.dev';
const scenario = process.argv[2] ?? '1';
const headers = { 'content-type': 'application/json', origin: 'https://halyn-voice.vercel.app' };
const s = await fetch(`${API}/web/session`, {
  method: 'POST',
  headers: { ...headers, 'x-demo-code': process.env.DEMO_ACCESS_CODE ?? '' },
  body: JSON.stringify({ kind: 'console' }),
});
console.log('session', s.status);
const { token } = await s.json();
const auth = { ...headers, authorization: `Bearer ${token}` };
const r = await fetch(`${API}/web/stage/run/${scenario}`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ mode: 'text' }),
});
console.log('run', r.status, JSON.stringify(await r.json()));
for (let i = 0; i < 20; i++) {
  await new Promise((res) => setTimeout(res, 3000));
  const t = await fetch(`${API}/web/tests/runs/latest`, { headers: auth });
  const body = await t.json().catch(() => null);
  const status = body?.run?.status ?? body?.status;
  if (status && status !== 'running') {
    console.log('latest suite run', t.status, status);
    break;
  }
}
const v = await fetch(`${API}/web/ledger/verify`, { headers: auth });
console.log('ledger verify', v.status, JSON.stringify(await v.json()));
