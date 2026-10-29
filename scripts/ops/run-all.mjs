// Halyn Test "Run all scenarios" on the deployed API, as the Console does it (text mode, live Hub, demo customer):
// create the suite run, then run each scenario in it one by one and wait for its result. Prints the scorecard — the
// numbers the README quotes. Console session with the demo code from .env (never printed).
// Usage (repo root): node scripts/ops/run-all.mjs [IN|US]
process.loadEnvFile('.env');
const API = 'https://halyn-api.halyn-api.workers.dev';
const region = process.argv[2] ?? null;
const headers = { 'content-type': 'application/json', origin: 'https://halyn-voice.vercel.app' };
const s = await fetch(`${API}/web/session`, {
  method: 'POST',
  headers: { ...headers, 'x-demo-code': process.env.DEMO_ACCESS_CODE ?? '' },
  body: JSON.stringify({ kind: 'console' }),
});
const { token } = await s.json();
const auth = { ...headers, authorization: `Bearer ${token}` };
const created = await (
  await fetch(`${API}/web/tests/runs`, { method: 'POST', headers: auth, body: JSON.stringify({ region }) })
).json();
const id = created.run.id;
console.log('suite', id, created.run.scenarios.join(' '));
let result = created;
for (const scenario of created.run.scenarios) {
  const r = await fetch(`${API}/web/stage/run/${scenario}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ mode: 'text', suite_run_id: id }),
  });
  if (r.status !== 200) console.log(scenario, 'start', r.status, (await r.text()).slice(0, 200));
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    result = await (await fetch(`${API}/web/tests/runs/${id}`, { headers: auth })).json();
    if (result.run.results.some((x) => x.scenario_id === scenario)) break;
  }
}
console.log('scorecard', JSON.stringify(result.scorecard));
for (const r of result.run.results)
  console.log(r.scenario_id, r.status, r.propose_ms ?? '', (r.failures ?? []).join(' | ').slice(0, 200));
