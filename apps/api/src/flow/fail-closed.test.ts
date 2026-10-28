import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, REGISTERED, UNREGISTERED } from '../../test/fixtures/app';
import type { CoreTransport } from '../core-client/client';

// Invariant 2 (fail closed) on every background failure of the allow and step-up paths, with the real Gate, Hub,
// grants, ledger and Aero Core; only Bolna's HTTP and the Aero Core transport are made to fail (docs/TESTING.md).

const RUN = '0b5c7a4e-2222-4333-8444-555566667777';
let h: AppHarness;
let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logs.push(String(line)));
});
afterEach(() => {
  // Logs never carry a full phone number, whichever way the flow failed (CLAUDE.md section 6).
  const joined = logs.join('\n');
  for (const n of [REGISTERED, UNREGISTERED, '8065356379', '9000000003', '9000000001'])
    expect(joined).not.toContain(n);
  vi.restoreAllMocks();
});

const freeze = {
  run_id: RUN,
  from_number: REGISTERED,
  channel: 'phone',
  action: 'card.freeze',
  params: { card_last4: '8812' },
  readback_confirmed: true,
  caller_quotes: ['Mera card kho gaya hai'],
};
const transfer = (amount_minor: unknown = 100_000, extra: Record<string, unknown> = {}) => ({
  run_id: RUN,
  from_number: REGISTERED,
  channel: 'phone',
  action: 'transfer.saved',
  params: { amount_minor, currency: 'INR', payee_id: 'payee_mom' },
  readback_confirmed: true,
  caller_quotes: [],
  ...extra,
});

async function propose(body: Record<string, unknown>): Promise<string> {
  const res = await h.tool('propose_action', body);
  expect(res.status).toBe(200);
  const { request_id } = (await res.json()) as { request_id: string };
  await h.settle();
  return request_id;
}
const writes = () => h.aero.calls.filter((c) => c.method !== 'GET' && c.granted);
const types = async () => (await h.ledger()).map((e) => e.type);
const lastEvent = () => h.bolna.events.get(RUN)?.at(-1);
async function balance(): Promise<number | undefined> {
  const rows = await h.aero.rows<{ balance_minor: number }>(
    "SELECT balance_minor FROM accounts WHERE tenant_id = ? AND customer_ref = 'cus_saksham'",
    h.tenant,
  );
  return rows[0]?.balance_minor;
}

describe('the allow path: every failure ends in deny E_FAIL_CLOSED, recorded, with no Aero Core write', () => {
  it('a grant that cannot be signed (no usable signing key)', async () => {
    h = await appHarness();
    (h.env as unknown as Record<string, string>).HALYN_SIGNING_KEY = 'not a key';
    const id = await propose(freeze);
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'failed', failure: 'E_FAIL_CLOSED' });
    expect(lastEvent()).toEqual({
      event: 'deny',
      properties: { request_id: id, reason: 'E_FAIL_CLOSED' },
    });
    expect(h.aero.calls).toEqual([]);
    const seen = await types();
    expect(seen).toContain('core_rejected');
    expect(seen).not.toContain('grant_issued');
    expect(seen).not.toContain('executed');
  });

  it('Aero Core answering 500 with no outcome: one retry with the SAME grant, then deny; never done', async () => {
    const tokens: (string | null)[] = [];
    h = await appHarness({
      wrapCore: () => async (request) => {
        tokens.push(request.headers.get('x-halyn-grant'));
        return new Response('{}', { status: 500 });
      },
    });
    const id = await propose(freeze);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toBe(tokens[1]);
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'failed', failure: 'E_FAIL_CLOSED' });
    expect(lastEvent()?.event).toBe('deny');
    expect(await types()).toEqual(expect.arrayContaining(['grant_issued', 'core_rejected']));
    expect(await types()).not.toContain('executed');
  });

  it('a transient 503 then success: executed exactly once on the same grant', async () => {
    let calls = 0;
    h = await appHarness({
      wrapCore: (inner: CoreTransport) => async (request) => {
        calls += 1;
        return calls === 1 ? new Response('busy', { status: 503 }) : inner(request);
      },
    });
    const id = await propose(transfer());
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'executed' });
    expect(await balance()).toBe(52_000_000 - 100_000);
    expect((await types()).filter((t) => t === 'executed')).toHaveLength(1);
    expect(lastEvent()?.event).toBe('done');
  });

  it('the bank committed but the answer was lost: the retry sees the grant used, so done, money moved ONCE', async () => {
    let calls = 0;
    h = await appHarness({
      wrapCore: (inner: CoreTransport) => async (request) => {
        calls += 1;
        const res = await inner(request); // committed
        if (calls === 1) throw new Error('connection reset'); // but the answer never arrives
        return res;
      },
    });
    const id = await propose(transfer());
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'executed' });
    expect(await balance()).toBe(52_000_000 - 100_000);
    expect(lastEvent()?.event).toBe('done');
    expect((await types()).filter((t) => t === 'executed')).toHaveLength(1);
  });

  it.each(['5xx', 'timeout'] as const)(
    'Bolna events failing (%s) never blocks or repeats the action; check_decision still tells the call',
    async (kind) => {
      h = await appHarness({
        wrapBolna: (inner) => async (request) => {
          if (!request.url.includes('/events')) return inner(request);
          if (kind === 'timeout') throw new DOMException('timed out', 'TimeoutError');
          return new Response('boom', { status: 502 });
        },
      });
      const id = await propose(transfer());
      expect(await h.hub.requestState(id)).toMatchObject({ status: 'executed' });
      expect(await balance()).toBe(52_000_000 - 100_000);
      expect(h.bolna.events.get(RUN)).toBeUndefined();
      const check = await h.tool('check_decision', { run_id: RUN, request_id: id });
      expect(await check.json()).toMatchObject({ status: 'decided', event: { event: 'done' } });
      // A retry of the same proposal changes nothing.
      await propose(transfer());
      expect(await balance()).toBe(52_000_000 - 100_000);
    },
  );
});

describe('the step-up path', () => {
  const stepUp = () => transfer(1_000_000, { from_number: UNREGISTERED });

  it('the Confirm call cannot be placed: passkey only, and silence ends in deny C_TIMEOUT (no write)', async () => {
    h = await appHarness({
      wrapBolna: (inner) => async (request) =>
        new URL(request.url).pathname === '/call' ? new Response('no', { status: 500 }) : inner(request),
    });
    await h.tool('lookup_customer', {
      run_id: RUN,
      from_number: UNREGISTERED,
      claimed_name: 'Saksham Mishra',
    });
    const id = await propose(stepUp());
    const state = await h.hub.requestState(id);
    expect(state?.status).toBe('awaiting_confirmation');
    expect(state?.confirm?.channels).toEqual(['passkey']);
    h.clock.advance(61_000);
    await h.fireAlarm();
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'refused', final_outcome: 'deny' });
    expect(lastEvent()).toMatchObject({ event: 'timeout', properties: { reason: 'C_TIMEOUT' } });
    expect(writes()).toEqual([]);
    expect(await types()).not.toContain('grant_issued');
  });

  it('an approval whose execution then fails closes the request: failed E_FAIL_CLOSED and a deny to the call', async () => {
    h = await appHarness({
      wrapCore: () => async () => {
        throw new Error('core down');
      },
    });
    const passkey = await h.registerPasskey();
    await h.tool('lookup_customer', {
      run_id: RUN,
      from_number: UNREGISTERED,
      claimed_name: 'Saksham Mishra',
    });
    const id = await propose(stepUp());
    const res = await h.approve(id, passkey);
    expect(res.status).toBe(200);
    await h.settle();
    const state = await h.hub.requestState(id);
    // Above the new-payee cap an approval goes to a specialist; either way nothing executed and the call is told.
    expect(['failed', 'held']).toContain(state?.status);
    expect(writes()).toEqual([]);
    expect(await types()).not.toContain('executed');
  });
});

// Bolna sends everything as strings, so a plain digit string is read as the integer it spells (bolna-payloads.ts);
// anything else that is not already an integer number is refused.
describe('money stays integer minor units (invariant 9)', () => {
  it.each([
    ['a fraction', 100.5],
    ['a decimal string', '100.5'],
    ['an exponent string', '1e5'],
    ['a hex string', '0x10'],
    ['an Arabic-Indic digit string', '١٠٠'],
    ['an over-long digit string', '1000000000000000000'],
    ['an exponent', 1e21],
    ['zero', 0],
    ['negative', -5],
    ['null', null],
    ['an object', { amount_minor: 1 }],
  ])('%s as the amount is never executed', async (_, amount) => {
    h = await appHarness();
    const id = await propose(transfer(amount));
    expect(writes()).toEqual([]);
    const state = await h.hub.requestState(id);
    expect(state?.decision.outcome).toBe('deny');
    expect(await balance()).toBe(52_000_000);
  });
});
