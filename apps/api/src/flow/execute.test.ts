import { CORE_RESPONSES } from '@halyn/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, REGISTERED } from '../../test/fixtures/app';
import { createApp } from '../index';
import { doneSummary, primaryAccount } from './execute';

// Execution after allow/approval (invariant 1) and every way it can end: done, refused by the bank, unknown, no route,
// scheduled after a tier-4 hold. Real Hub, real Aero Core.

const RUN = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
let h: AppHarness;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

async function propose(action: string, params: Record<string, unknown>, run_id = RUN) {
  const res = await h.tool('propose_action', {
    run_id,
    from_number: REGISTERED,
    action,
    params,
    readback_confirmed: true,
  });
  await h.settle();
  const { request_id } = (await res.json()) as { request_id: string };
  return { request_id, record: await h.hub.requestState(request_id) };
}

describe('allow → grant → Aero Core', () => {
  it('a bank refusal is not executed: ledger core_rejected, the call hears deny E_CORE_REJECTED', async () => {
    // Allowed by the Gate (tier 1, within the limit) but not the fee's amount: Aero Core refuses with 400.
    const { request_id, record } = await propose('fee.waive', {
      amount_minor: 100,
      currency: 'INR',
      fee_id: 'fee_late_oct',
    });
    expect(record).toMatchObject({ status: 'failed', failure: 'E_CORE_REJECTED' });
    expect(h.bolna.events.get(RUN)).toEqual([
      { event: 'allow', properties: { request_id } },
      { event: 'deny', properties: { request_id, reason: 'E_CORE_REJECTED' } },
    ]);
    const types = (await h.ledger()).filter((e) => e.ref_id === request_id).map((e) => e.type);
    expect(types).toEqual(['proposed', 'decided', 'grant_issued', 'core_rejected']);
    // A refused write does not count as used: the real waiver is still allowed.
    const second = await propose(
      'fee.waive',
      { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' },
      `${RUN.slice(0, -1)}0`,
    );
    expect(second.record).toMatchObject({ status: 'executed' });
  });

  it('Aero Core unreachable → unknown → fail closed (deny E_FAIL_CLOSED), never "done"', async () => {
    const app = createApp({
      clock: h.clock,
      rng: h.rng,
      bolnaFetch: h.bolna.fetch,
      coreTransport: () => async () => {
        throw new Error('down');
      },
    });
    const res = await app.request(
      '/tools/propose_action',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-halyn-secret': 'test-tool-secret-0123456789abcdef0123456789',
          'cf-connecting-ip': '13.203.39.153',
        },
        body: JSON.stringify({
          run_id: RUN,
          from_number: REGISTERED,
          action: 'card.freeze',
          params: { card_last4: '8812' },
          readback_confirmed: true,
        }),
      },
      h.env,
      {
        waitUntil: (p: Promise<unknown>) => void p.then(() => undefined),
        passThroughOnException: () => undefined,
      } as unknown as ExecutionContext,
    );
    const { request_id } = (await res.json()) as { request_id: string };
    await vi.waitFor(async () => expect((await h.hub.requestState(request_id))?.status).toBe('failed'));
    expect((await h.hub.requestState(request_id))?.failure).toBe('E_FAIL_CLOSED');
    await vi.waitFor(() => expect(h.bolna.events.get(RUN)?.at(-1)?.event).toBe('deny'));
  });

  it('no Aero Core configured at all → fail closed', async () => {
    const app = createApp({
      clock: h.clock,
      rng: h.rng,
      bolnaFetch: h.bolna.fetch,
      coreTransport: () => null,
    });
    const pending: Promise<unknown>[] = [];
    const res = await app.request(
      '/tools/propose_action',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-halyn-secret': 'test-tool-secret-0123456789abcdef0123456789',
          'cf-connecting-ip': '13.203.39.153',
        },
        body: JSON.stringify({
          run_id: RUN,
          from_number: REGISTERED,
          action: 'card.freeze',
          params: { card_last4: '8812' },
          readback_confirmed: true,
        }),
      },
      h.env,
      {
        waitUntil: (p: Promise<unknown>) => void pending.push(p),
        passThroughOnException: () => undefined,
      } as unknown as ExecutionContext,
    );
    await Promise.all(pending);
    const { request_id } = (await res.json()) as { request_id: string };
    expect(await h.hub.requestState(request_id)).toMatchObject({
      status: 'failed',
      failure: 'E_FAIL_CLOSED',
    });
  });
});

describe('approvals that cannot execute now go to a specialist', () => {
  it('upi.raise_limit (no Aero Core route): approved → handoff, event hold H_SPECIALIST', async () => {
    const passkey = await h.registerPasskey();
    const { request_id } = await propose('upi.raise_limit', { amount_minor: 10000000, currency: 'INR' });
    expect((await h.approve(request_id, passkey)).status).toBe(200);
    await h.settle();
    const record = await h.hub.requestState(request_id);
    expect(record).toMatchObject({ final_outcome: 'allow', status: 'held' });
    expect(record?.handoff_id).toMatch(/^ho_/);
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up', 'approved', 'hold']);
    expect(h.aero.calls).toEqual([]);
  });

  it('a tier-4 change (profile.change_mobile): approved → scheduled after the 24 h hold, event hold P_TIER4_HOLD_24H', async () => {
    const passkey = await h.registerPasskey();
    const { request_id } = await propose('profile.change_mobile', { new_number: '+919000000002' });
    expect((await h.approve(request_id, passkey)).status).toBe(200);
    await h.settle();
    const record = await h.hub.requestState(request_id);
    expect(record?.execute_at).not.toBeNull();
    expect(record?.last_event).toEqual({
      event: 'hold',
      properties: { request_id, reason: 'P_TIER4_HOLD_24H' },
    });
  });

  it('executes at most once even if asked twice', async () => {
    const { request_id } = await propose('card.freeze', { card_last4: '8812' });
    const { executeRequest } = await import('./execute');
    const { flowContext } = await import('./context');
    const ctx = flowContext(h.env, h.tenant, {
      clock: h.clock,
      rng: h.rng,
      bolnaFetch: h.bolna.fetch,
      coreTransport: () => h.aero.transport,
    });
    expect(await executeRequest(ctx, request_id)).toBeNull();
    expect(h.aero.calls.filter((c) => c.path === '/core/cards/freeze')).toHaveLength(1);
  });
});

describe('what Aero says back (spoken summaries)', () => {
  it('names the result without full numbers, for every Aero Core action', () => {
    const balance = { amount_minor: 52000000, currency: 'INR' as const };
    const txn = {
      id: 'txn_1',
      kind: 'debit' as const,
      category: 'transfer' as const,
      amount: { amount_minor: 490000, currency: 'INR' as const },
      description: 'Transfer to Landlord',
      payee_id: 'payee_landlord',
      reference: 'AERO-ABC123',
      created_at: '2026-10-28T05:00:00.000Z',
    };
    const at = '2026-10-28T05:00:00.000Z';
    const bodies = [
      CORE_RESPONSES['card.freeze'].parse({
        action: 'card.freeze',
        reference: 'AERO-ABC123',
        card: { last4: '8812', status: 'frozen' },
        already_frozen: true,
      }),
      CORE_RESPONSES['fee.waive'].parse({
        action: 'fee.waive',
        reference: 'AERO-ABC123',
        fee: { id: 'fee_late_oct', status: 'waived', amount: { amount_minor: 60000, currency: 'INR' } },
        balance,
      }),
      CORE_RESPONSES['emi.move_date'].parse({
        action: 'emi.move_date',
        reference: 'AERO-ABC123',
        loan: { id: 'loan_personal_1', emi_day: 10, previous_emi_day: 5 },
      }),
      CORE_RESPONSES['transfer.saved'].parse({
        action: 'transfer.saved',
        reference: 'AERO-ABC123',
        transaction: txn,
        balance,
      }),
      CORE_RESPONSES['balance.view'].parse({
        action: 'balance.view',
        account: 'savings',
        balance,
        as_of: at,
      }),
      CORE_RESPONSES['statement.view'].parse({
        action: 'statement.view',
        account: 'savings',
        account_last4: '3094',
        balance,
        transactions: [txn],
        cards: [],
        loans: [],
        as_of: at,
      }),
    ];
    expect(bodies.map((b) => doneSummary(b.action, b, 'x'))).toEqual([
      'The card ending 8812 is frozen (it already was)',
      'The ₹600 fee is waived. Balance ₹5,20,000',
      'The EMI moves to day 10 of each month (it was day 5)',
      'Sent ₹4,900. Balance ₹5,20,000',
      'The savings balance is ₹5,20,000',
      'The savings balance is ₹5,20,000. Latest: -₹4,900 Transfer to Landlord',
    ]);
    expect(doneSummary('card.freeze', null, 'Freeze the card ending 8812')).toBe(
      'Done: Freeze the card ending 8812',
    );
    expect(primaryAccount('US')).toBe('checking');
  });
});
