import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../bolna/client';
import { type AppHarness, appHarness, REGISTERED } from '../../test/fixtures/app';

// Console pages' API (Step 13): every route refuses a customer session and reads the Hub. A coached hold gives the
// call, request, handoff and signal rows; Bolna (agent, execution) is answered by a wrapper around the recorder.

const RUN = '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const COACHED = [
  'Mujhe yeh paisa RBI verification account mein bhejna hai',
  'The officer said not to tell anyone, it is a safe account',
];
const CONSOLE_ROUTES = [
  '/web/calls',
  `/web/calls/${RUN}`,
  '/web/policies',
  '/web/console/passes',
  '/web/signals',
  '/web/ledger/export',
  '/web/integrations',
];

const bolnaExtras = (inner: FetchLike): FetchLike => {
  return async (request) => {
    const url = new URL(request.url);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (url.pathname.startsWith('/v2/agent/'))
      return json({
        agent_name: 'Aero',
        agent_status: 'processed',
        restricted: false,
        agent_config: { webhook_url: 'https://halyn.example/webhooks/bolna?key=topsecret' },
        tasks: [{ tools_config: { api_tools: { tools: 'x-halyn-secret: topsecret' } } }],
      });
    if (url.pathname === `/executions/${RUN}`)
      return json({
        id: RUN,
        agent_id: '00000000-0000-4000-8000-00000000ae01',
        status: 'completed',
        transcript: 'user: my number is +919000000077\nassistant: I have passed this to a specialist.',
        telephony_data: { recording_url: 'https://recordings.example/r.mp3' },
      });
    return inner(request);
  };
};

let h: AppHarness;
afterEach(() => vi.restoreAllMocks());

async function coachedCall() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness({ wrapBolna: bolnaExtras });
  const res = await h.tool('propose_action', {
    run_id: RUN,
    from_number: REGISTERED,
    action: 'transfer.new_payee',
    params: {
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
      payee_name: 'Ravi',
    },
    readback_confirmed: true,
    caller_quotes: COACHED,
  });
  const { request_id } = (await res.json()) as { request_id: string };
  await h.settle();
  return { request_id, token: await h.consoleToken() };
}

describe('Console API', () => {
  it('refuses customer sessions on every console route', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    h = await appHarness();
    const customer = await h.customerToken();
    for (const path of CONSOLE_ROUTES) expect((await h.web(path, undefined, customer)).status, path).toBe(401);
    expect((await h.web('/web/console/passes/pass_demo', undefined, customer, 'DELETE')).status).toBe(401);
  });

  it('lists the call and shows its request, handoff, masked transcript and recording', async () => {
    const { request_id, token } = await coachedCall();
    const list = (await (await h.web('/web/calls', undefined, token)).json()) as {
      calls: { run_id: string; requests: number; last_outcome: string }[];
    };
    expect(list.calls.find((c) => c.run_id === RUN)).toMatchObject({ requests: 1, last_outcome: 'hold' });

    const res = await h.web(`/web/calls/${RUN}`, undefined, token);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as Record<string, unknown> & {
      requests: { request_id: string; cues: string[]; reasons: string[] }[];
      handoffs: unknown[];
      transcript: string;
    };
    expect(detail.requests[0]).toMatchObject({ request_id, reasons: expect.arrayContaining(['S_COACHING']) });
    expect(detail.requests[0]?.cues.length).toBeGreaterThan(0);
    expect(detail.handoffs).toHaveLength(1);
    expect(detail).toMatchObject({ transcript_status: 'ok', recording_url: 'https://recordings.example/r.mp3' });
    expect(detail.transcript).not.toContain('9000000077');
    expect(JSON.stringify(detail)).not.toContain('officer');
    expect((await h.web('/web/calls/no-such-run', undefined, token)).status).toBe(404);
  });

  it('counts signals and cues without the caller’s words', async () => {
    const { request_id, token } = await coachedCall();
    const body = (await (await h.web('/web/signals', undefined, token)).json()) as {
      reasons: { code: string; count: number }[];
      latest: { request_id: string }[];
    };
    expect(body.reasons).toContainEqual({ code: 'S_COACHING', count: 1 });
    expect(body.latest.map((r) => r.request_id)).toEqual([request_id]);
    expect(JSON.stringify(body)).not.toMatch(/officer|verification account/);
  });

  it('lists every Pass and revokes one into the ledger', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    h = await appHarness();
    const token = await h.consoleToken();
    const list = (await (await h.web('/web/console/passes', undefined, token)).json()) as {
      passes: { id: string; customer_id: string; status: string }[];
    };
    expect(list.passes).toContainEqual(expect.objectContaining({ id: 'pass_demo', customer_id: 'cus_saksham' }));
    const res = await h.web('/web/console/passes/pass_demo', undefined, token, 'DELETE');
    expect(await res.json()).toMatchObject({ pass: { id: 'pass_demo', status: 'revoked' } });
    await h.settle();
    expect((await h.ledger()).map((e) => e.type)).toContain('pass_revoked');
    expect((await h.web('/web/console/passes/pass_nope', undefined, token, 'DELETE')).status).toBe(404);
  });

  it('serves the packs, the ledger export and integrations without secrets', async () => {
    const { token } = await coachedCall();
    const policies = (await (await h.web('/web/policies', undefined, token)).json()) as {
      packs: { region: string }[];
    };
    expect(policies.packs.map((p) => p.region)).toContain('IN');

    const exported = await h.web('/web/ledger/export', undefined, token);
    expect(exported.headers.get('content-disposition')).toMatch(/attachment; filename="halyn-ledger-/);
    const chain = (await exported.json()) as { verify: { ok: boolean }; entries: unknown[] };
    expect(chain.verify.ok).toBe(true);
    expect(chain.entries.length).toBeGreaterThan(1);

    const res = await h.web('/web/integrations', undefined, token);
    const text = await res.text();
    expect(text).not.toMatch(/topsecret|key=/);
    expect(JSON.parse(text)).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({ role: 'aero_in', restricted: false, webhook_host: 'halyn.example' }),
      ]),
      guards: { ip_allowlist: true, tool_secret: true, bolna_key: true },
      aero_core: { ok: true },
    });
  });
});
