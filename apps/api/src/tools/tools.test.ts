import {
  CheckDecisionResponseSchema,
  ErrorEnvelopeSchema,
  LookupCustomerResponseSchema,
  paramsHash,
} from '@halyn/shared';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT,
  type AppHarness,
  appHarness,
  REGISTERED,
  SPOKEN,
  UNKNOWN_AI,
  UNREGISTERED,
} from '../../test/fixtures/app';
import { IN_PACK, US_PACK } from '../../test/fixtures/gate';
import { registeredNumberHash } from '../db/numbers';
import type { HubDO } from '../hub/hub-do';
import { packKey } from '../packs/load';

// The six Bolna tools and the webhook through the real app, Hub, Gate and Aero Core (test/fixtures/app.ts).

const RUN = '0b5c7a4e-1111-4222-8333-444455556666';
let h: AppHarness;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

const freeze = (run_id = RUN, extra: Record<string, unknown> = {}) => ({
  run_id,
  from_number: REGISTERED,
  channel: 'phone',
  action: 'card.freeze',
  params: { card_last4: '8812' },
  readback_confirmed: true,
  caller_quotes: ['Mera card kho gaya hai'],
  ...extra,
});

async function propose(body: Record<string, unknown>) {
  const res = await h.tool('propose_action', body);
  const json = (await res.json()) as { request_id: string; status: string };
  return { res, json };
}

describe('the Bolna guard covers every tool and the webhook', () => {
  it.each([
    'lookup_customer',
    'verify_pass',
    'propose_action',
    'get_pass_code',
    'confirm_result',
    'check_decision',
  ])('%s without the secret → 401', async (tool) => {
    const res = await h.tool(tool, {}, { 'x-halyn-secret': 'wrong' });
    expect(res.status).toBe(401);
  });
});

describe('lookup_customer', () => {
  it('the registered number identifies the customer, who is named in Devanagari for the voice', async () => {
    const res = await h.tool('lookup_customer', { run_id: RUN, from_number: REGISTERED.replace('+', '') });
    expect(LookupCustomerResponseSchema.parse(await res.json())).toEqual({
      customer_found: true,
      customer_name: SPOKEN,
      region: 'IN',
      registered: true,
      language: 'hi',
    });
    expect(h.source.loads).toBe(1);
  });

  it('a claimed name from another phone finds the customer but is never proof (registered: false)', async () => {
    const res = await h.tool('lookup_customer', {
      run_id: RUN,
      from_number: UNREGISTERED,
      claimed_name: 'saksham mishra',
    });
    expect(await res.json()).toMatchObject({ customer_found: true, registered: false });
  });

  it('an unknown number without a name finds nobody; a bad body is a 400', async () => {
    expect(await (await h.tool('lookup_customer', { run_id: RUN, from_number: UNKNOWN_AI })).json()).toEqual({
      customer_found: false,
      registered: false,
    });
    const bad = await h.tool('lookup_customer', { run_id: RUN, from_number: 'nobody' });
    expect(bad.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await bad.json()).error.code).toBe('E_BAD_REQUEST');
  });
});

describe('get_pass_code and verify_pass (docs/PASS.md)', () => {
  async function code(): Promise<string> {
    const res = await h.tool('get_pass_code', { run_id: RUN, pass_token: h.passToken });
    expect(res.status).toBe(200);
    return ((await res.json()) as { code: string }).code;
  }

  it('the assistant gets a 6-digit code; spoken with pauses it verifies once, from its own number', async () => {
    const c = await code();
    expect(c).toMatch(/^\d{6}$/);
    const ok = await h.tool('verify_pass', {
      run_id: RUN,
      from_number: ASSISTANT,
      code: c.split('').join(' '),
    });
    expect(await ok.json()).toEqual({
      valid: true,
      assistant_name: "Saksham's Assistant",
      scopes_summary: 'statement.view, card.freeze, emi.move_date',
    });
    const replay = await h.tool('verify_pass', { run_id: RUN, from_number: ASSISTANT, code: c });
    expect(await replay.json()).toEqual({ valid: false });
  });

  it('a code from another number is invalid; five failures lock the Pass (ledger pass_locked)', async () => {
    const c = await code();
    expect(
      await (await h.tool('verify_pass', { run_id: RUN, from_number: UNKNOWN_AI, code: c })).json(),
    ).toEqual({
      valid: false,
    });
    for (let i = 0; i < 5; i++)
      await h.tool('verify_pass', { run_id: RUN, from_number: ASSISTANT, code: '000000' });
    expect((await h.ledger()).some((e) => e.type === 'pass_locked')).toBe(true);
    const refused = await h.tool('get_pass_code', { run_id: RUN, pass_token: h.passToken });
    expect(refused.status).toBe(400);
  });

  it('refuses a forged token or another calling number', async () => {
    const forged = await h.tool('get_pass_code', {
      run_id: RUN,
      pass_token: `${h.passToken.slice(0, -4)}AAAA`,
    });
    expect(forged.status).toBe(400);
    const other = await h.tool('get_pass_code', {
      run_id: RUN,
      pass_token: h.passToken,
      from_number: UNKNOWN_AI,
    });
    expect(other.status).toBe(400);
  });
});

describe('propose_action (docs/ARCHITECTURE.md "Main flow")', () => {
  it('answers pending within 300 ms with no TiDB on the hot path; TiDB writes come later from the outbox', async () => {
    // Bolna's budget is for a warm Worker: warm this isolate's code path and pack parse on another call first.
    const warm = '0b5c7a4e-9999-4222-8333-444455556666';
    await h.tool('lookup_customer', { run_id: warm, from_number: REGISTERED });
    await propose({ ...freeze(warm), action: 'statement.view', params: { account: 'savings' } });
    await h.settle();
    await h.fireAlarm();
    await h.tool('lookup_customer', { run_id: RUN, from_number: REGISTERED });
    const loads = h.source.loads;
    const batches = h.ledgerSink.batches.length;
    const mirrorCalls = h.mirror.calls;
    const started = Date.now();
    const { res, json } = await propose(freeze());
    const ms = Date.now() - started;
    expect(res.status).toBe(200);
    expect(json).toEqual({ request_id: expect.stringMatching(/^req_/), status: 'pending' });
    expect(ms).toBeLessThan(300);
    // Nothing went to TiDB while answering: no directory load, no ledger flush, no mirror write.
    expect(h.source.loads).toBe(loads);
    expect(h.ledgerSink.batches).toHaveLength(batches);
    expect(h.mirror.calls).toBe(mirrorCalls);
    await h.settle();
    await h.fireAlarm();
    expect(h.mirror.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['call', 'request', 'grant']));
    expect(h.ledgerSink.batches.flat().map((e) => e.type)).toEqual(
      expect.arrayContaining(['proposed', 'decided', 'grant_issued', 'executed']),
    );
  });

  it('an LLM retry of the same proposal is the same request: one decision, one set of events (invariant 7)', async () => {
    const first = await propose(freeze());
    const again = await Promise.all([propose(freeze()), propose(freeze())]);
    expect(again.map((a) => a.json.request_id)).toEqual([first.json.request_id, first.json.request_id]);
    await h.settle();
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['allow', 'done']);
    expect((await h.ledger()).filter((e) => e.type === 'decided')).toHaveLength(1);
  });

  it('the same (run_id, params_hash) is the same request for the whole call, whatever its age or state (invariant 7)', async () => {
    const first = await propose(freeze());
    await h.settle();
    expect(await h.hub.requestState(first.json.request_id)).toMatchObject({ status: 'executed' });
    const writes = () => h.aero.calls.filter((c) => c.method !== 'GET' && c.granted).length;
    expect(writes()).toBe(1);
    for (const gap of [15_000, 600_000, 3_600_000]) {
      h.clock.advance(gap);
      const later = await propose(freeze());
      expect(later.json.request_id).toBe(first.json.request_id);
      await h.settle();
      const check = await h.tool('check_decision', { run_id: RUN, request_id: first.json.request_id });
      expect(await check.json()).toMatchObject({ status: 'decided', event: { event: 'done' } });
    }
    expect(writes()).toBe(1);
    expect((await h.ledger()).filter((e) => e.type === 'decided')).toHaveLength(1);
    expect((await h.ledger()).filter((e) => e.type === 'grant_issued')).toHaveLength(1);
  });

  it('reads Bolna’s stringly, flat body (the Day-0 agent shape)', async () => {
    const { res } = await propose({
      run_id: RUN,
      from_number: REGISTERED.slice(3),
      action: 'card.freeze',
      card_last4: '8812',
      readback_confirmed: 'true',
      caller_quotes: 'Card kho gaya',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['an unknown action', { action: 'bank.rob', params: {} }],
    ['bad params', { params: { card_last4: '88' } }],
    ['an extra param', { params: { card_last4: '8812', note: 'x' } }],
  ])('%s is a recorded deny E_FAIL_CLOSED, not a 400 (ADR-010)', async (_, patch) => {
    const { res, json } = await propose(freeze(RUN, patch));
    expect(res.status).toBe(200);
    await h.settle();
    const record = await h.hub.requestState(json.request_id);
    expect(record?.decision).toMatchObject({ outcome: 'deny', reasons: ['E_FAIL_CLOSED'] });
    expect(h.bolna.events.get(RUN)).toEqual([
      { event: 'deny', properties: { request_id: json.request_id, reason: 'E_FAIL_CLOSED' } },
    ]);
    expect(h.aero.calls).toEqual([]);
  });

  it('no policy pack in KV → deny E_FAIL_CLOSED (an unknown policy is never guessed)', async () => {
    await h.env.CONFIG.delete(packKey(h.tenant, 'IN'));
    const { json } = await propose(freeze(RUN, { run_id: 'c6c1b0e2-0000-4000-8000-000000000001' }));
    expect((await h.hub.requestState(json.request_id))?.decision.reasons).toEqual(['E_FAIL_CLOSED']);
  });

  it('without a run id it keys the call by call_sid (no event can be sent; check_decision answers)', async () => {
    const { json } = await propose(freeze(RUN, { run_id: '%(execution_id)s', call_sid: 'CA-no-run' }));
    await h.settle();
    expect([...h.bolna.events.keys()]).toEqual([]);
    const record = await h.hub.requestState(json.request_id);
    expect(record?.run_id).toBe('sid:CA-no-run');
    const res = await h.tool('check_decision', {
      run_id: 'None',
      call_sid: 'CA-no-run',
      request_id: json.request_id,
    });
    expect(CheckDecisionResponseSchema.parse(await res.json())).toMatchObject({
      status: 'decided',
      event: { event: 'done' },
    });
  });

  it('after a webhook told us the call sid, a tool without a run id finds the real run', async () => {
    const hook = await h.fetch('/webhooks/bolna', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-halyn-secret': 'test-tool-secret-0123456789abcdef0123456789',
        'cf-connecting-ip': '13.203.39.153',
      },
      body: JSON.stringify({
        id: RUN,
        status: 'in-progress',
        telephony_data: { provider_call_id: 'CA-known' },
      }),
    });
    expect(await hook.json()).toEqual({ ok: true });
    const { json } = await propose(freeze('%(execution_id)s', { call_sid: 'CA-known' }));
    expect((await h.hub.requestState(json.request_id))?.run_id).toBe(RUN);
  });
});

describe('check_decision', () => {
  it('answers the event the call would have received; another call cannot see it', async () => {
    const { json } = await propose(freeze());
    await h.settle();
    const res = await h.tool('check_decision', { run_id: RUN, request_id: json.request_id });
    expect(await res.json()).toEqual({
      request_id: json.request_id,
      status: 'decided',
      event: {
        event: 'done',
        properties: { reference: expect.stringMatching(/^AERO-/), summary: 'The card ending 8812 is frozen' },
      },
    });
    const other = await h.tool('check_decision', { run_id: 'someone-else', request_id: json.request_id });
    expect(other.status).toBe(404);
  });
});

describe('confirm_result (the Confirm callback)', () => {
  // ₹10,000 to a saved payee from another phone: tier 2 + unregistered number = 3 → step-up.
  const transfer = {
    run_id: RUN,
    from_number: UNREGISTERED,
    action: 'transfer.saved',
    params: { amount_minor: 1000000, currency: 'INR', payee_id: 'payee_mom' },
    readback_confirmed: true,
  };

  async function stepUp() {
    await h.tool('lookup_customer', {
      run_id: RUN,
      from_number: UNREGISTERED,
      claimed_name: 'Saksham Mishra',
    });
    const { json } = await propose(transfer);
    await h.settle();
    const call = h.bolna.calls.find((c) => c.request_id === json.request_id);
    if (!call) throw new Error('no Confirm call');
    return { request_id: json.request_id, call };
  }

  it('rings the registered number from B with the spoken name; an approval executes the transfer', async () => {
    const { request_id, call } = await stepUp();
    expect(call.user_data).toMatchObject({ customer_name: SPOKEN, request_id, language: 'Hinglish' });
    expect(JSON.stringify(call.user_data)).not.toContain('Saksham');
    const res = await h.tool('confirm_result', {
      run_id: call.execution_id,
      request_id,
      answer: 'yes',
      method: 'speech',
    });
    expect(await res.json()).toEqual({ ok: true });
    await h.settle();
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up', 'approved', 'done']);
    // The Confirm call itself hears `recorded`, so its graph says goodbye and hangs up.
    expect(h.bolna.events.get(call.execution_id)).toEqual([
      { event: 'recorded', properties: { request_id } },
    ]);
    expect(await h.hub.requestState(request_id)).toMatchObject({
      final_outcome: 'allow',
      status: 'executed',
    });
    expect(h.aero.calls.filter((c) => c.path === '/core/transfers')).toEqual([
      { method: 'POST', path: '/core/transfers', granted: true, status: 200 },
    ]);
  });

  it('only the call Halyn placed may answer; a second answer is recorded and ignored (invariant 10)', async () => {
    const { request_id, call } = await stepUp();
    const stranger = await h.tool('confirm_result', {
      run_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      request_id,
      answer: 'approve',
      method: 'speech',
    });
    expect(stranger.status).toBe(404);
    await h.tool('confirm_result', {
      run_id: call.execution_id,
      request_id,
      answer: 'decline',
      method: 'keypad',
    });
    const late = await h.tool('confirm_result', {
      run_id: call.execution_id,
      request_id,
      answer: 'approve',
      method: 'speech',
    });
    expect(await late.json()).toEqual({ ok: true });
    await h.settle();
    expect(await h.hub.requestState(request_id)).toMatchObject({ final_outcome: 'deny', status: 'refused' });
    expect(h.aero.calls.some((c) => c.path === '/core/transfers')).toBe(false);
  });

  // A callback answer is out-of-band proof only when it comes from the Confirm call Halyn placed. Any other caller the
  // guard lets through — the Aero call itself, a call known only by its call sid — is told the request does not exist,
  // and nothing is recorded.
  const answersRecorded = () =>
    runInDurableObject(h.raw, (_: HubDO, state) =>
      state.storage.sql.exec('SELECT request_id FROM confirmation_answers').toArray(),
    );
  const notThisCall = async (request_id: string, who: Record<string, unknown>) => {
    const res = await h.tool('confirm_result', { request_id, answer: 'approve', method: 'keypad', ...who });
    expect(res.status, JSON.stringify(who)).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await res.json()).error).toEqual({
      code: 'E_NOT_FOUND',
      message: 'No such confirmation',
    });
  };

  it('before the Confirm call is attached (no execution id), no call can answer for the callback leg', async () => {
    await h.tool('lookup_customer', {
      run_id: RUN,
      from_number: UNREGISTERED,
      claimed_name: 'Saksham Mishra',
    });
    // The Hub offers the callback; the Worker has not placed (or could not place) the Confirm call yet.
    const pepper = (env as unknown as { PHONE_HASH_PEPPER: string }).PHONE_HASH_PEPPER;
    const { record } = await h.hub.propose({
      run_id: RUN,
      call_sid: null,
      channel: 'phone',
      from_number: UNREGISTERED,
      number_hash: await registeredNumberHash(pepper, UNREGISTERED),
      default_region: 'IN',
      action: transfer.action,
      params_json: JSON.stringify(transfer.params),
      params_hash: await paramsHash(transfer.params),
      readback_confirmed: true,
      caller_quotes: [],
      coaching: { score: 0, cues: [] },
      distress: false,
      packs: { IN: IN_PACK, US: US_PACK },
      callback: { available: true, number_hash: await registeredNumberHash(pepper, REGISTERED) },
    });
    expect(record.confirm).toMatchObject({ channels: ['passkey', 'callback'], execution_id: null });
    await notThisCall(record.request_id, { run_id: RUN });
    await notThisCall(record.request_id, { run_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    await notThisCall(record.request_id, { call_sid: 'CA00000000000000000000000000000001' });
    expect(await h.hub.requestState(record.request_id)).toMatchObject({ status: 'awaiting_confirmation' });
    expect(await answersRecorded()).toEqual([]);
  });

  it('a step-up whose callback was never placed cannot be answered by any call', async () => {
    // The Confirm call could not be placed (Bolna refused): the passkey is the only leg left.
    h = await appHarness({
      wrapBolna: (inner) => async (request) =>
        new URL(request.url).pathname === '/call'
          ? new Response('{"message":"no"}', { status: 500 })
          : inner(request),
    });
    await h.tool('lookup_customer', {
      run_id: RUN,
      from_number: UNREGISTERED,
      claimed_name: 'Saksham Mishra',
    });
    const { json } = await propose(transfer);
    await h.settle();
    expect((await h.hub.requestState(json.request_id))?.confirm).toMatchObject({
      channels: ['passkey'],
      execution_id: null,
    });
    await notThisCall(json.request_id, { run_id: RUN });
    await notThisCall(json.request_id, { call_sid: 'CA00000000000000000000000000000002' });
    expect(await h.hub.requestState(json.request_id)).toMatchObject({ status: 'awaiting_confirmation' });
    expect(await answersRecorded()).toEqual([]);
  });

  it('once the Confirm call is placed, only it answers: not the Aero call, not a call known by its sid', async () => {
    const { request_id, call } = await stepUp();
    await notThisCall(request_id, { run_id: RUN });
    await notThisCall(request_id, { call_sid: 'CA00000000000000000000000000000003' });
    expect(await answersRecorded()).toEqual([]);
    const res = await h.tool('confirm_result', {
      run_id: call.execution_id,
      request_id,
      answer: 'approve',
      method: 'keypad',
    });
    expect(await res.json()).toEqual({ ok: true });
    await h.settle();
    expect(await h.hub.requestState(request_id)).toMatchObject({
      final_outcome: 'allow',
      status: 'executed',
    });
  });

  it('no answer in 60 s → the Hub’s alarm denies C_TIMEOUT and tells the call itself', async () => {
    const { request_id } = await stepUp();
    h.clock.advance(61_000);
    await h.fireAlarm();
    expect(h.bolna.events.get(RUN)?.at(-1)).toEqual({
      event: 'timeout',
      properties: { request_id, reason: 'C_TIMEOUT' },
    });
    expect(h.bolna.stopped).toHaveLength(1);
  });
});

describe('a step-up for a caller already on the registered phone (voice smoke call 2)', () => {
  it('rings no callback — it would hit call waiting on the same phone — and offers the passkey only', async () => {
    await h.tool('lookup_customer', { run_id: RUN, from_number: REGISTERED });
    const { json } = await propose({
      ...freeze(),
      action: 'transfer.new_payee',
      params: {
        amount_minor: 4500000,
        currency: 'INR',
        payee_account_last4: '4471',
        payee_ifsc: 'AERO0000001',
      },
    });
    await h.settle();
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up']);
    expect(h.bolna.calls.filter((c) => c.request_id === json.request_id)).toEqual([]);
    expect((await h.hub.requestState(json.request_id))?.confirm?.channels).toEqual(['passkey']);
  });
});

describe('the webhook', () => {
  it('acknowledges an unreadable record without acting, and refuses a non-JSON body', async () => {
    const headers = {
      'content-type': 'application/json',
      'x-halyn-secret': 'test-tool-secret-0123456789abcdef0123456789',
      'cf-connecting-ip': '13.203.39.153',
    };
    const odd = await h.fetch('/webhooks/bolna', { method: 'POST', headers, body: '{"status":"completed"}' });
    expect(await odd.json()).toEqual({ ok: false });
    const bad = await h.fetch('/webhooks/bolna', { method: 'POST', headers, body: 'nope' });
    expect(bad.status).toBe(400);
    const done = await h.fetch('/webhooks/bolna', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: RUN,
        status: 'completed',
        context_details: { recipient_data: { purpose: 'security_demo' } },
      }),
    });
    expect(await done.json()).toEqual({ ok: true });
  });

  // Step 16 review: the tool body's from_number is filled by Bolna but also visible to the LLM, so a caller who talks
  // the model into "my number is …" must not become the registered customer. Bolna's own record of the call wins.
  const inbound = (from: string) => ({
    id: RUN,
    status: 'in-progress',
    telephony_data: {
      from_number: from,
      to_number: '+918065356344',
      call_type: 'inbound',
      call_sid: 'CAsid0001',
    },
  });
  const hook = (body: unknown) =>
    h.fetch('/webhooks/bolna', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-halyn-secret': 'test-tool-secret-0123456789abcdef0123456789',
        'cf-connecting-ip': '13.203.39.153',
      },
      body: JSON.stringify(body),
    });

  it("the calling number in Bolna's record beats a different from_number in a tool body", async () => {
    await hook(inbound(UNREGISTERED));
    const res = await h.tool('lookup_customer', { run_id: RUN, from_number: REGISTERED });
    expect(await res.json()).toMatchObject({ registered: false });
    // ₹10,000 to a saved payee: tier 2 → allow from the registered number, step-up from any other.
    await propose({
      ...freeze(),
      action: 'transfer.saved',
      params: { amount_minor: 1000000, currency: 'INR', payee_id: 'payee_mom' },
    });
    await h.settle();
    const events = h.bolna.events.get(RUN)?.map((e) => e.event) ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events).not.toContain('allow');
    expect(events).not.toContain('done');
  });

  it("a Pass code counts only from the assistant number in Bolna's record (chat #8 finding 1)", async () => {
    const code = (
      (await (await h.tool('get_pass_code', { run_id: RUN, pass_token: h.passToken })).json()) as {
        code: string;
      }
    ).code;
    await hook(inbound(UNKNOWN_AI));
    const spoofed = await h.tool('verify_pass', { run_id: RUN, from_number: ASSISTANT, code });
    expect(await spoofed.json()).toEqual({ valid: false });
    // The refused attempt neither used the code nor named the Pass: the real assistant's call still verifies.
    const OTHER = '0b5c7a4e-1111-4222-8333-999999999999';
    await hook({
      ...inbound(ASSISTANT),
      id: OTHER,
      telephony_data: { ...inbound(ASSISTANT).telephony_data, call_sid: 'CAsid0002' },
    });
    const real = await h.tool('verify_pass', { run_id: OTHER, from_number: ASSISTANT, code });
    expect(await real.json()).toMatchObject({ valid: true });
  });

  it("Bolna's record of the registered number identifies the customer", async () => {
    await hook(inbound(REGISTERED.replace('+', '')));
    const res = await h.tool('lookup_customer', { run_id: RUN, from_number: REGISTERED });
    expect(await res.json()).toMatchObject({ customer_found: true, registered: true });
  });

  it('a record that arrives after a spoofed lookup takes the proof back', async () => {
    await h.tool('lookup_customer', { run_id: RUN, from_number: REGISTERED });
    await hook(inbound(UNREGISTERED));
    // ₹10,000 to a saved payee: tier 2 → allow from the registered number, step-up from any other.
    await propose({
      ...freeze(),
      action: 'transfer.saved',
      params: { amount_minor: 1000000, currency: 'INR', payee_id: 'payee_mom' },
    });
    await h.settle();
    const events = h.bolna.events.get(RUN)?.map((e) => e.event) ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events).not.toContain('allow');
    expect(events).not.toContain('done');
  });
});

describe('the demo reset (S_CALL_BURST during retakes, chat #8 finding 9)', () => {
  const runId = (n: number) => `0b5c7a4e-1111-4222-8333-${String(n).padStart(12, '0')}`;
  async function callAndFreeze(n: number): Promise<string[]> {
    await h.tool('lookup_customer', { run_id: runId(n), from_number: REGISTERED });
    const { json } = await propose(freeze(runId(n)));
    return (await h.hub.requestState(json.request_id))?.decision.reasons ?? [];
  }

  it('a console reset stops earlier calls counting towards the burst; calls and ledger rows stay', async () => {
    await callAndFreeze(1);
    await callAndFreeze(2);
    expect(await callAndFreeze(3)).toContain('S_CALL_BURST');
    const head = await h.hub.ledgerHead();
    h.clock.advance(60_000);

    expect((await h.web('/web/stage/demo-reset', {}, await h.customerToken())).status).toBe(401);
    const res = await h.web('/web/stage/demo-reset', {}, await h.consoleToken());
    expect(await res.json()).toEqual({ ok: true });
    h.clock.advance(1_000);

    expect(await callAndFreeze(4)).not.toContain('S_CALL_BURST');
    expect((await h.hub.consoleCalls()).calls.length).toBeGreaterThanOrEqual(4);
    expect((await h.hub.ledgerHead())?.seq).toBeGreaterThan(head?.seq ?? 0);
  });
});
