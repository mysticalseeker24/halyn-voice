// Halyn Day-0 probe (docs/DAY0.md). A throwaway Worker that answers the test agent's custom functions, injects
// events back into the call, mints a web-call session, and times TiDB / D1 / Sarvam from Cloudflare's network.
// It stores only masked call facts (last 4 digits) and returns timings, never secrets. Delete after Day 0.

const BOLNA = 'https://api.bolna.ai';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const last4 = (value) =>
  typeof value === 'string' && /\d{4}/.test(value) ? `••••${value.replace(/\D/g, '').slice(-4)}` : null;

function fromBolna(request, env) {
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  return env.BOLNA_SOURCE_IPS.split(',')
    .map((s) => s.trim())
    .includes(ip);
}

function toolAuthorised(request, env) {
  return (
    fromBolna(request, env) && same(request.headers.get('x-halyn-secret') ?? '', env.HALYN_TOOL_SECRET ?? '')
  );
}

function codeOk(url, env) {
  return Boolean(env.PROBE_ACCESS_CODE) && same(url.searchParams.get('code') ?? '', env.PROBE_ACCESS_CODE);
}

async function log(env, kind, data) {
  const key = `log:${new Date().toISOString()}:${crypto.randomUUID().slice(0, 8)}`;
  await env.LOG.put(key, JSON.stringify({ kind, at: new Date().toISOString(), ...data }), {
    expirationTtl: 3 * 86400,
  });
}

async function readBody(request) {
  const text = await request.text();
  try {
    return { parsed: JSON.parse(text), raw: text };
  } catch {
    return { parsed: null, raw: text };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function injectEvent(env, runId, event, properties) {
  const started = Date.now();
  const res = await fetch(`${BOLNA}/v1/call/${runId}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event, properties }),
  });
  const detail = (await res.text()).slice(0, 200);
  return { event, status: res.status, ms: Date.now() - started, detail };
}

/** Check 2: where does the run id come from? The tool param first, then the pre-call / execution webhooks. */
async function resolveRunId(env, body) {
  if (typeof body?.run_id === 'string' && UUID.test(body.run_id))
    return { runId: body.run_id, source: 'tool_param' };
  const sid = typeof body?.call_sid === 'string' ? body.call_sid : '';
  if (sid) {
    const mapped = await env.LOG.get(`run:${sid}`);
    if (mapped) return { runId: mapped, source: 'webhook_by_call_sid' };
  }
  const latest = await env.LOG.get('run:latest', 'json');
  if (latest && Date.now() - latest.at < 120_000) return { runId: latest.id, source: 'latest_webhook' };
  return { runId: null, source: 'none' };
}

async function proposeAction(request, env, ctx) {
  const { parsed } = await readBody(request);
  const body = parsed && typeof parsed === 'object' ? parsed : {};
  const { runId, source } = await resolveRunId(env, body);
  const requestId = `req_day0_${Date.now()}`;
  await log(env, 'propose_action', {
    request_id: requestId,
    run_id: runId,
    run_id_source: source,
    run_id_param_raw: typeof body.run_id === 'string' ? body.run_id.slice(0, 40) : null,
    call_sid_present:
      typeof body.call_sid === 'string' && body.call_sid.length > 0 && !body.call_sid.includes('%('),
    from_last4: last4(body.from_number),
    to_last4: last4(body.to_number),
    body_keys: Object.keys(body).sort(),
    action: typeof body.action === 'string' ? body.action.slice(0, 40) : null,
    readback_confirmed: body.readback_confirmed ?? null,
  });
  if (runId) {
    ctx.waitUntil(
      (async () => {
        await sleep(1000);
        const allow = await injectEvent(env, runId, 'allow', { request_id: requestId });
        await sleep(1500);
        const done = await injectEvent(env, runId, 'done', {
          reference: `D0-${String(Date.now()).slice(-4)}`,
          summary: 'Card ending 8812 frozen (Day-0 test)',
        });
        await log(env, 'events', { request_id: requestId, run_id: runId, results: [allow, done] });
      })(),
    );
  }
  return json({ request_id: requestId, status: 'pending' });
}

async function webhook(request, env, kind) {
  const { parsed } = await readBody(request);
  const body = parsed && typeof parsed === 'object' ? parsed : {};
  const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null;
  const telephony = body.telephony_data && typeof body.telephony_data === 'object' ? body.telephony_data : {};
  const sid = telephony.provider_call_id ?? body.call_sid ?? null;
  if (id) {
    await env.LOG.put('run:latest', JSON.stringify({ id, at: Date.now() }), { expirationTtl: 3600 });
    if (typeof sid === 'string' && sid) await env.LOG.put(`run:${sid}`, id, { expirationTtl: 3600 });
  }
  await log(env, kind, {
    execution_id: id,
    status: body.status ?? null,
    call_sid_present: Boolean(sid),
    from_last4: last4(telephony.from_number ?? body.user_number),
    keys: Object.keys(body).sort().slice(0, 40),
  });
  return json({ ok: true });
}

async function timed(fn, runs = 3) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    const started = Date.now();
    let ok = true;
    let note = null;
    try {
      note = await fn();
    } catch (err) {
      ok = false;
      note = String(err?.message ?? err).slice(0, 160);
    }
    out.push({ ok, ms: Date.now() - started, note });
  }
  return out;
}

async function probeTidb(env) {
  return timed(async () => {
    const res = await fetch(`https://http-${env.TIDB_HOST}/v1beta/sql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Basic ${btoa(`${env.TIDB_USERNAME}:${env.TIDB_PASSWORD}`)}`,
        'TiDB-Database': 'test',
      },
      body: JSON.stringify({ query: 'SELECT 1 AS one' }),
    });
    if (!res.ok) throw new Error(`tidb ${res.status}`);
    await res.text();
    return `status ${res.status}`;
  });
}

async function probeD1(env) {
  return timed(async () => {
    const row = await env.DB.prepare('SELECT 1 AS one').first();
    return `one=${row?.one}`;
  });
}

async function probeSarvam(env) {
  return timed(async () => {
    const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-subscription-key': env.SARVAM_API_KEY },
      body: JSON.stringify({
        model: 'sarvam-105b-conversations',
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 16,
        temperature: 0,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`sarvam ${res.status}: ${text.slice(0, 120)}`);
    return `status ${res.status}`;
  }, 2);
}

async function mintWebSession(request, env) {
  if (!UUID.test(env.AERO_TEST_AGENT_ID ?? '')) return json({ error: 'AERO_TEST_AGENT_ID not set' }, 500);
  const { parsed } = await readBody(request);
  const res = await fetch(`${BOLNA}/web-call/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ agent_id: env.AERO_TEST_AGENT_ID, user_data: parsed?.user_data ?? {} }),
  });
  await log(env, 'web_session', { status: res.status });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}

function webCallPage(code) {
  const sessionUrl = `/webcall/session?code=${encodeURIComponent(code)}`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Halyn Day-0 web call</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<h1 style="font-size:20px">Day-0 check 7: web call</h1>
<p>Calls the Aero <b>test</b> agent from this browser. The agent is an AI and the call is recorded.</p>
<button id="b" style="font-size:18px;padding:12px 20px">Call Aero (test)</button>
<button id="s" style="font-size:18px;padding:12px 20px">Hang up</button>
<pre id="o"></pre>
<script src="https://cdn.jsdelivr.net/gh/bolna-ai/web-call@v3.0.1/dist/bolna-web-call.min.js"></script>
<script>
const o = document.getElementById('o'); const say = (m) => { o.textContent += m + '\\n'; };
const call = new BolnaWebCall({ sessionUrl: ${JSON.stringify(sessionUrl)} });
call.on('state-change', (s) => say('state: ' + s));
call.on('call-start', () => say('connected'));
call.on('call-end', (e) => say('ended: ' + (e && e.reason)));
call.on('error', (e) => say('error: ' + (e && (e.code + ' ' + e.message))));
document.getElementById('b').onclick = () => call.start();
document.getElementById('s').onclick = () => call.stop();
</script>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export default {
  /** Checks 11-12 without an inbound request (some networks block *.workers.dev): runs once, results to KV. */
  async scheduled(_event, env, ctx) {
    if (await env.LOG.get('probe:timings-done')) return;
    await env.LOG.put('probe:timings-done', '1', { expirationTtl: 3 * 86400 });
    ctx.waitUntil(
      (async () => {
        const results = {
          tidb: await probeTidb(env),
          d1: await probeD1(env),
          sarvam: await probeSarvam(env),
        };
        await log(env, 'timings', { check: '11-12', results });
      })(),
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (request.method === 'POST' && pathname.startsWith('/tools/')) {
      if (!toolAuthorised(request, env)) return json({ error: 'unauthorized' }, 401);
      if (pathname === '/tools/propose_action') return proposeAction(request, env, ctx);
      const { parsed } = await readBody(request);
      await log(env, pathname.slice(7), {
        keys: parsed && typeof parsed === 'object' ? Object.keys(parsed).sort() : [],
        answer: parsed?.answer ?? null,
        method: parsed?.method ?? null,
      });
      return json({ ok: true });
    }
    if (request.method === 'POST' && pathname.startsWith('/webhooks/')) {
      if (!fromBolna(request, env)) return json({ error: 'unauthorized' }, 401);
      return webhook(request, env, pathname.slice(10) || 'webhook');
    }
    if (!codeOk(url, env))
      return pathname === '/' ? new Response('halyn day0 probe') : json({ error: 'not found' }, 404);
    if (pathname === '/probe/tidb') return json({ check: 11, target: 'tidb', runs: await probeTidb(env) });
    if (pathname === '/probe/d1') return json({ check: 11, target: 'd1', runs: await probeD1(env) });
    if (pathname === '/probe/sarvam')
      return json({ check: 12, target: 'sarvam', runs: await probeSarvam(env) });
    if (pathname === '/probe/log') {
      const list = await env.LOG.list({ prefix: 'log:' });
      const keys = list.keys.slice(-50);
      const entries = await Promise.all(
        keys.map(async (k) => JSON.parse((await env.LOG.get(k.name)) ?? 'null')),
      );
      return json({ entries });
    }
    if (pathname === '/webcall') return webCallPage(url.searchParams.get('code') ?? '');
    if (pathname === '/webcall/session' && request.method === 'POST') return mintWebSession(request, env);
    return json({ error: 'not found' }, 404);
  },
};
