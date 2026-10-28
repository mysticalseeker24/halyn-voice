import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, UNREGISTERED } from '../../test/fixtures/app';
import type { HubDO } from '../hub/hub-do';

// Invariant 10: the first answer wins; every later answer is recorded and ignored; unanswered after 60 s is a deny.
// Four contenders race for one confirmation, in every order the test can shuffle them into: the passkey approval,
// the passkey decline, the Confirm call's spoken/keypad answer and the Hub's 60 s alarm (real Hub, Gate, grants,
// ledger and Aero Core).

const RUN = '0b5c7a4e-4444-4555-8666-777788889999';
type Contender = 'passkey_approve' | 'passkey_decline' | 'call_approve' | 'call_decline' | 'alarm';
const ALL: Contender[] = ['passkey_approve', 'passkey_decline', 'call_approve', 'call_decline', 'alarm'];

let h: AppHarness;
beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

/** A deterministic shuffle (mulberry32), so a failing order can be replayed from its seed. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * One rng seed per order: the cases share Aero Core's D1, whose used_grants is keyed by jti alone, so two cases signing
 * with the same seed at the same clock would mint the same jti and the second write would be refused as a replay.
 */
async function setup(seed: number) {
  h = await appHarness({ seed: 4242 + seed });
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

async function accepted(): Promise<{ answer: string; channel: string; accepted: number }[]> {
  return runInDurableObject(h.raw, (_: HubDO, state) =>
    state.storage.sql
      .exec<{ answer: string; channel: string; accepted: number }>(
        'SELECT answer, channel, accepted FROM confirmation_answers ORDER BY rowid',
      )
      .toArray(),
  );
}

describe('first answer wins (invariant 10)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    'order %i: one accepted answer, one outcome, at most one write, and a decline never executes',
    async (seed) => {
      const { passkey, request_id, execution_id } = await setup(seed);
      const order = shuffled(ALL, seed);
      // Odd seeds: 1 s before the deadline, the answers race each other (the alarm has nothing due yet). Even seeds:
      // exactly on the deadline, every answer is too late and the timeout wins in any order, alarm or no alarm.
      const atDeadline = seed % 2 === 0;
      h.clock.advance(atDeadline ? 60_000 : 59_000);
      const run: Record<Contender, () => Promise<unknown>> = {
        passkey_approve: () => h.approve(request_id, passkey),
        passkey_decline: async () =>
          h.web(`/web/approvals/${request_id}/decline`, {}, await h.customerToken()),
        call_approve: () =>
          h.tool('confirm_result', { run_id: execution_id, request_id, answer: 'approve', method: 'keypad' }),
        call_decline: () =>
          h.tool('confirm_result', { run_id: execution_id, request_id, answer: 'decline', method: 'speech' }),
        alarm: () => h.fireAlarm(),
      };
      await Promise.all(order.map((name) => run[name]()));
      await h.settle();
      await h.fireAlarm();

      const state = await h.hub.requestState(request_id);
      const answers = await accepted();
      const winners = answers.filter((a) => a.accepted === 1);
      // At most one accepted answer (the alarm's timeout is a settled result, not an answer row).
      expect(winners.length).toBeLessThanOrEqual(1);
      const writes = h.aero.calls.filter((c) => c.method !== 'GET' && c.granted);
      expect(writes.length).toBeLessThanOrEqual(1);
      const ledger = (await h.ledger()).filter((e) => e.ref_id === request_id);
      expect(ledger.filter((e) => e.type === 'executed').length).toBe(writes.length);
      expect(ledger.filter((e) => e.type === 'grant_issued').length).toBe(writes.length);

      if (atDeadline) {
        expect(winners).toEqual([]);
        expect(ledger.filter((e) => e.type === 'confirmed').map((e) => e.payload)).toEqual([
          { status: 'timeout', channel: null, reason: 'C_TIMEOUT' },
        ]);
      }
      if (winners[0]?.answer === 'approved') {
        expect(state?.final_outcome).toBe('allow');
      } else {
        // A decline or the timeout: nothing may have executed.
        expect(state?.final_outcome).toBe('deny');
        expect(writes).toEqual([]);
        expect(state?.status).toBe('refused');
      }
      // The call hears exactly one terminal event for this request.
      const terminal = (h.bolna.events.get(RUN) ?? []).filter((e) =>
        ['approved', 'denied', 'declined', 'timeout', 'done', 'deny', 'hold'].includes(e.event),
      );
      const kinds = new Set(
        terminal.map((e) => (e.event === 'approved' || e.event === 'done' ? 'yes' : 'no')),
      );
      expect(kinds.size).toBeLessThanOrEqual(1);
    },
  );

  it('a late approval after the timeout is recorded, ignored and never executes', async () => {
    const { passkey, request_id } = await setup(0);
    h.clock.advance(61_000);
    await h.fireAlarm();
    const late = await h.approve(request_id, passkey);
    expect(late.status).toBe(400);
    await h.settle();
    expect(await h.hub.requestState(request_id)).toMatchObject({ status: 'refused', final_outcome: 'deny' });
    expect(h.aero.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('a replayed approval (same assertion twice) executes once', async () => {
    const { passkey, request_id } = await setup(0);
    const [first, second] = await Promise.all([
      h.approve(request_id, passkey),
      h.approve(request_id, passkey),
    ]);
    await h.settle();
    expect([first.status, second.status].filter((s) => s === 200).length).toBe(1);
    expect(h.aero.calls.filter((c) => c.method !== 'GET' && c.granted)).toHaveLength(1);
  });
});
