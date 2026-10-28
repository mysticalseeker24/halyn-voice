import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, UNREGISTERED, WEB_ORIGIN } from '../../test/fixtures/app';
import type { SoftPasskey } from '../../test/fixtures/webauthn';
import type { HubDO } from '../hub/hub-do';

// Invariant 10, the late side. The Hub's alarm may run late (queued, or the Hub was busy), so an answer can arrive
// after the 60 s deadline while the confirmation is still pending. It must not count: the Hub settles the timeout
// first — deny C_TIMEOUT, the `timeout` event, the ledger, exactly what the alarm does — and records the answer as
// ignored. Real Hub, Gate, passkeys and Aero Core; the clock stands past the deadline and the alarm has not run.

const RUN = '0b5c7a4e-5555-4666-8777-888899990000';
let h: AppHarness;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

/** ₹10,000 to a saved payee from another phone: a step-up with the passkey and the Confirm callback. */
async function stepUp() {
  const passkey = await h.registerPasskey();
  await h.tool('lookup_customer', { run_id: RUN, from_number: UNREGISTERED, claimed_name: 'Saksham Mishra' });
  const res = await h.tool('propose_action', {
    run_id: RUN,
    from_number: UNREGISTERED,
    action: 'transfer.saved',
    params: { amount_minor: 1_000_000, currency: 'INR', payee_id: 'payee_mom' },
    readback_confirmed: true,
  });
  const { request_id } = (await res.json()) as { request_id: string };
  await h.settle();
  const call = h.bolna.calls.find((c) => c.request_id === request_id);
  if (!call) throw new Error('no Confirm call placed');
  return { passkey, request_id, execution_id: call.execution_id };
}

const events = () => h.bolna.events.get(RUN) ?? [];

async function answers(): Promise<{ answer: string; channel: string; accepted: number }[]> {
  return runInDurableObject(h.raw, (_: HubDO, state) =>
    state.storage.sql
      .exec<{ answer: string; channel: string; accepted: number }>(
        'SELECT answer, channel, accepted FROM confirmation_answers ORDER BY id',
      )
      .toArray(),
  );
}

/** What every late answer must leave behind: one timeout, nothing executed, one event to the call. */
async function expectTimedOutOnce(request_id: string): Promise<void> {
  const timeout = { event: 'timeout', properties: { request_id, reason: 'C_TIMEOUT' } };
  await vi.waitFor(() => expect(events()).toContainEqual(timeout));
  expect(await h.hub.requestState(request_id)).toMatchObject({
    status: 'refused',
    final_outcome: 'deny',
    last_event: timeout,
  });
  const ledger = (await h.ledger()).filter((e) => e.ref_id === request_id);
  expect(ledger.filter((e) => e.type === 'confirmed').map((e) => e.payload)).toEqual([
    { status: 'timeout', channel: null, reason: 'C_TIMEOUT' },
  ]);
  expect(ledger.map((e) => e.type)).not.toContain('grant_issued');
  expect(h.aero.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  // The alarm, when it finally runs, finds nothing left to settle.
  await h.fireAlarm();
  expect(events().map((e) => e.event)).toEqual(['step_up', 'timeout']);
  // The Confirm call still queued is stopped, once.
  await vi.waitFor(() => expect(h.bolna.stopped).toHaveLength(1));
  expect((await h.ledger()).filter((e) => e.ref_id === request_id && e.type === 'confirmed')).toHaveLength(1);
}

describe('an answer after the deadline, before the alarm ran (invariant 10)', () => {
  it('a Confirm-call approval 1 s late is recorded and refused; the request times out once', async () => {
    const { request_id, execution_id } = await stepUp();
    h.clock.advance(61_000);
    const res = await h.tool('confirm_result', {
      run_id: execution_id,
      request_id,
      answer: 'approve',
      method: 'keypad',
    });
    // Recorded (the tool's contract), but it did not count.
    expect(await res.json()).toEqual({ ok: true });
    await h.settle();
    await expectTimedOutOnce(request_id);
    expect(await answers()).toEqual([{ answer: 'approved', channel: 'callback', accepted: 0 }]);
  });

  it('a passkey approval signed in time but sent 1 s late is refused; the request times out once', async () => {
    const { passkey, request_id } = await stepUp();
    const token = await h.customerToken();
    h.clock.advance(50_000);
    const res = await h.web(`/web/approvals/${request_id}/options`, {}, token);
    expect(res.status).toBe(200);
    const { options } = (await res.json()) as { options: Parameters<SoftPasskey['authenticate']>[0] };
    const assertion = await passkey.authenticate(options, WEB_ORIGIN);
    h.clock.advance(11_000);
    const late = await h.web(`/web/approvals/${request_id}/verify`, { response: assertion }, token);
    expect(late.status).toBe(400);
    await h.settle();
    await expectTimedOutOnce(request_id);
    expect(await answers()).toEqual([{ answer: 'approved', channel: 'passkey', accepted: 0 }]);
  });

  it('a decline exactly at the deadline is a timeout, not a decline', async () => {
    const { request_id } = await stepUp();
    h.clock.advance(60_000);
    const res = await h.web(`/web/approvals/${request_id}/decline`, {}, await h.customerToken());
    expect(res.status).toBe(400);
    await h.settle();
    await expectTimedOutOnce(request_id);
    expect(await answers()).toEqual([{ answer: 'declined', channel: 'passkey', accepted: 0 }]);
  });
});
