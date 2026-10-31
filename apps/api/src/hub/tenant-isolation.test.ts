import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, REGISTERED } from '../../test/fixtures/app';
import { uniqueTenant } from '../../test/fixtures/api';
import { hubStub } from './client';
import type { HubRpc } from './client';
import { env } from 'cloudflare:workers';

// Invariant 8 (tenant isolation): every Hub RPC refuses a tenant other than the one its Durable Object is bound to,
// and two tenants sharing the same Worker, KV and D1 never see each other's requests, ledger or money.

const NOT_CALLED = () => ({ ok: true, value: 1 }) as never;

// One call per RPC with plausible arguments. `satisfies` makes the table complete: a new Hub RPC will not compile
// until it is added here (and therefore proven tenant-bound).
const RPC_CALLS = {
  appendLedger: (s, t) => s.appendLedger(t, { type: 'proposed', ref_id: 'req_x', payload: {} }),
  ledgerHead: (s, t) => s.ledgerHead(t),
  ledgerEntries: (s, t) => s.ledgerEntries(t, 1, 10),
  idempotent: (s, t) => s.idempotent(t, 'run:hash', 60, NOT_CALLED),
  startConfirmation: (s, t) =>
    s.startConfirmation(t, { request_id: 'req_x', channels: ['passkey'], timeout_seconds: 60 }),
  resolveConfirmation: (s, t) =>
    s.resolveConfirmation(t, { request_id: 'req_x', answer: 'approved', channel: 'passkey' }),
  confirmationResult: (s, t) => s.confirmationResult(t, 'req_x'),
  broadcast: (s, t) => s.broadcast(t, { type: 'hello', at: new Date(0).toISOString() } as never, ['aero']),
  sockets: (s, t) => s.sockets(t),
  warm: (s, t) => s.warm(t),
  identifyCaller: (s, t) => s.identifyCaller(t, {} as never),
  verifyPassCode: (s, t) => s.verifyPassCode(t, {} as never),
  mintPassCode: (s, t) => s.mintPassCode(t, {} as never),
  propose: (s, t) => s.propose(t, {} as never),
  requestState: (s, t) => s.requestState(t, 'req_x'),
  runIdForCallSid: (s, t) => s.runIdForCallSid(t, 'CA123'),
  recordExecution: (s, t) =>
    s.recordExecution(t, { run_id: 'r', call_sid: null, ended: false, recording_url: null, purpose: null }),
  beginExecution: (s, t) => s.beginExecution(t, 'req_x'),
  noteGrant: (s, t) => s.noteGrant(t, 'req_x', { token: 'a.b.c' }),
  finishExecution: (s, t) =>
    s.finishExecution(t, 'req_x', { status: 'handoff', reason: 'H_SPECIALIST' } as never),
  attachCallback: (s, t) => s.attachCallback(t, 'req_x', null),
  customerView: (s, t) => s.customerView(t, 'cus_saksham'),
  putChallenge: (s, t) =>
    s.putChallenge(t, {
      challenge: 'c',
      customer_id: 'cus_saksham',
      kind: 'registration',
      request_id: null,
    } as never),
  takeChallenge: (s, t) =>
    s.takeChallenge(t, { challenge: 'c', customer_id: 'cus_saksham', kind: 'registration' } as never),
  passkeys: (s, t) => s.passkeys(t, 'cus_saksham'),
  savePasskey: (s, t) => s.savePasskey(t, {} as never),
  customerPasses: (s, t) => s.customerPasses(t, 'cus_saksham'),
  issuePass: (s, t) => s.issuePass(t, {} as never),
  revokePass: (s, t) => s.revokePass(t, 'cus_saksham', 'pass_demo'),
  attachAssistantCall: (s, t) => s.attachAssistantCall(t, 'run', 'pass_demo'),
  assistantCallPass: (s, t) => s.assistantCallPass(t, 'run'),
  setStageRegion: (s, t) => s.setStageRegion(t, 'US'),
  stageRegion: (s, t) => s.stageRegion(t),
  resetDemo: (s, t) => s.resetDemo(t),
  issueWsTicket: (s, t) => s.issueWsTicket(t, { kind: 'console', customer_id: null, role: 'stage' }),
  webCallCustomer: (s, t) => s.webCallCustomer(t, 'cus_saksham', 'US'),
  registerWebCall: (s, t) =>
    s.registerWebCall(t, { run_id: 'run', session_customer_id: 'cus_saksham', region: 'US' }),
  registerJudge: (s, t) => s.registerJudge(t, { name: 'Judge', number_hash: 'a'.repeat(64), last4: '1234' }),
  finishScreening: (s, t) => s.finishScreening(t, 'req_x', null),
  handoffs: (s, t) => s.handoffs(t),
  resolveHandoff: (s, t) => s.resolveHandoff(t, { id: 'ho_x', action: 'block', note: null }),
  consoleCalls: (s, t) => s.consoleCalls(t),
  consoleCall: (s, t) => s.consoleCall(t, 'run'),
  consoleRequests: (s, t) => s.consoleRequests(t),
  consolePasses: (s, t) => s.consolePasses(t),
  mirrorBacklog: (s, t) => s.mirrorBacklog(t),
  createTestRun: (s, t) => s.createTestRun(t, {} as never),
  recordTestResult: (s, t) => s.recordTestResult(t, 'trun_x', {} as never),
  testRuns: (s, t) => s.testRuns(t, null),
} satisfies Record<keyof HubRpc, (stub: HubRpc, tenant: string) => Promise<unknown>>;

describe('every Hub RPC is bound to its tenant', () => {
  it.each(Object.keys(RPC_CALLS) as (keyof typeof RPC_CALLS)[])(
    '%s refuses another tenant with E_FAIL_CLOSED, before touching anything',
    async (name) => {
      const mine = uniqueTenant();
      const theirs = uniqueTenant();
      const stub = hubStub(env, mine);
      // Bind the Hub to its own tenant first (the first caller binds it).
      expect((await stub.ledgerHead(mine)).ok).toBe(true);
      const result = await RPC_CALLS[name](stub, theirs);
      expect(result).toMatchObject({
        ok: false,
        code: 'E_FAIL_CLOSED',
        message: expect.stringMatching(/tenant/),
      });
      // …and a malformed tenant id is refused the same way.
      expect(await RPC_CALLS[name](stub, '../ten_x')).toMatchObject({ ok: false });
    },
  );
});

describe('two tenants side by side', () => {
  let a: AppHarness;
  let b: AppHarness;
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    a = await appHarness();
    b = await appHarness();
  });
  afterEach(() => vi.restoreAllMocks());

  const RUN = '0b5c7a4e-3333-4444-8555-666677778888';
  const transfer = {
    run_id: RUN,
    from_number: REGISTERED,
    channel: 'phone',
    action: 'transfer.saved',
    params: { amount_minor: 100_000, currency: 'INR', payee_id: 'payee_mom' },
    readback_confirmed: true,
  };

  async function aliceRequest(): Promise<string> {
    const res = await a.tool('propose_action', transfer);
    const { request_id } = (await res.json()) as { request_id: string };
    await a.settle();
    return request_id;
  }
  const balance = async (h: AppHarness) =>
    (
      await h.aero.rows<{ balance_minor: number }>(
        "SELECT balance_minor FROM accounts WHERE tenant_id = ? AND customer_ref = 'cus_saksham'",
        h.tenant,
      )
    )[0]?.balance_minor;

  it('money moved in one tenant never touches the other, even for the same customer id', async () => {
    await aliceRequest();
    expect(await balance(a)).toBe(52_000_000 - 100_000);
    expect(await balance(b)).toBe(52_000_000);
  });

  it('the other tenant’s Hub knows nothing of the request, the call or the decision', async () => {
    const id = await aliceRequest();
    expect(await a.hub.requestState(id)).not.toBeNull();
    expect(await b.hub.requestState(id)).toBeNull();
    const check = await b.tool('check_decision', { run_id: RUN, request_id: id });
    expect(check.status).toBe(404);
    expect((await b.ledger()).map((e) => e.ref_id)).not.toContain(id);
    expect((await b.hub.customerView('cus_saksham')).requests).toEqual([]);
  });

  it('web routes: a session of tenant B cannot view, answer, decline or list tenant A’s request', async () => {
    const id = await aliceRequest();
    const token = await b.customerToken();
    for (const path of [`/web/approvals/${id}/options`, `/web/approvals/${id}/decline`]) {
      const res = await b.web(path, {}, token);
      expect([400, 404]).toContain(res.status);
    }
    expect(await a.hub.requestState(id)).toMatchObject({ status: 'executed' });
    const home = (await (await b.web('/web/aero/home', undefined, token)).json()) as {
      alerts: { id: string }[];
    };
    expect(home.alerts.map((x) => x.id)).not.toContain(id);
    const ledger = await b.web('/web/ledger', undefined, await b.consoleToken());
    expect(JSON.stringify(await ledger.json())).not.toContain(id);
  });

  it('a Pass token minted for tenant A is refused by tenant B (invariant 8)', async () => {
    const res = await b.tool('get_pass_code', { run_id: RUN, pass_token: a.passToken });
    expect(res.status).toBe(400);
  });

  it('the tenant is fixed by the deployment: a tenant in a tool body or header is ignored', async () => {
    const res = await b.tool('lookup_customer', {
      run_id: RUN,
      from_number: REGISTERED,
      tenant_id: a.tenant,
    });
    expect(res.status).toBe(200);
    const header = await b.tool(
      'lookup_customer',
      { run_id: RUN, from_number: REGISTERED },
      { 'x-halyn-tenant': a.tenant },
    );
    expect(header.status).toBe(200);
    // Ignored: the call registered in B's Hub, A's Hub never heard of it.
    expect((await b.hub.customerView('cus_saksham')).customer).not.toBeNull();
    expect((await a.ledger()).length).toBe(0);
    const propose = await a.tool('propose_action', {
      ...transfer,
      run_id: 'bbbbbbbb-3333-4444-8555-666677778888',
    });
    expect(propose.status).toBe(200);
    expect((await b.ledger()).length).toBe(0);
  });
});
