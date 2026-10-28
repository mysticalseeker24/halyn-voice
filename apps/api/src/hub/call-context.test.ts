import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IN_PACK, US_PACK } from '../../test/fixtures/gate';
import {
  countsAsUsed,
  customerByName,
  gateCounters,
  normalizeName,
  passUses,
  periodKey,
  primaryReason,
  proposalEvent,
  unusualHour,
} from './call-context';
import type { DirectoryCustomer, RequestRecord } from './types';

// The pure helpers behind the Gate's context in the Hub (docs/GATE.md "Inputs", clarification 8).

const T0 = Date.UTC(2026, 9, 28, 5, 0, 0); // 10:30 IST
const HASH = 'a'.repeat(64);

function record(over: Partial<RequestRecord> & Pick<RequestRecord, 'action'>): RequestRecord {
  return {
    request_id: 'req_1',
    run_id: 'run',
    idem_key: 'k',
    call_id: 'call_1',
    customer_id: 'cus_saksham',
    region: 'IN',
    channel: 'phone',
    params: {},
    params_hash: HASH,
    readback_confirmed: true,
    caller_quotes: [],
    coaching: { score: 0, cues: [] },
    summary: 'x',
    created_at: T0,
    gate: {
      action: null,
      outcome: 'allow',
      tier: 2,
      base_tier: 2,
      proof: 'registered_number',
      signals: [],
      reasons: ['P_TIER2'],
      amount: { amount_minor: 490000, currency: 'INR' },
      confirm: null,
    },
    decision: { request_id: 'req_1', outcome: 'allow', tier: 2, base_tier: 2, reasons: ['P_TIER2'] },
    pack_sha: null,
    pass_id: null,
    status: 'executed',
    final_outcome: null,
    execute_at: null,
    confirm: null,
    execution: null,
    failure: null,
    handoff_id: null,
    last_event: null,
    ...over,
  };
}

describe('local time per region', () => {
  it('period keys are the customer’s local day, month and year', () => {
    // 23:30 UTC on Oct 31 is already Nov 1 in India, still Oct 31 in New York.
    const t = Date.UTC(2026, 9, 31, 23, 30);
    expect(periodKey(t, 'IN', 'day')).toBe('2026-11-01');
    expect(periodKey(t, 'IN', 'month')).toBe('2026-11');
    expect(periodKey(t, 'US', 'day')).toBe('2026-10-31');
    expect(periodKey(t, 'US', 'year')).toBe('2026');
  });

  it('unusual hour is 23:00–06:00 local', () => {
    expect(unusualHour(T0, 'IN')).toBe(false);
    expect(unusualHour(Date.UTC(2026, 9, 28, 18, 0), 'IN')).toBe(true); // 23:30 IST
    expect(unusualHour(Date.UTC(2026, 9, 28, 0, 0), 'IN')).toBe(true); // 05:30 IST
    expect(unusualHour(Date.UTC(2026, 9, 28, 0, 30), 'IN')).toBe(false); // 06:00 IST
  });
});

describe('Gate counters from the Hub’s requests', () => {
  it('count only what went through, per local period, and transfers in the last 10 minutes', () => {
    const records = [
      record({ action: 'transfer.saved' }),
      record({ action: 'transfer.saved', created_at: T0 - 11 * 60 * 1000 }),
      record({ action: 'transfer.saved', status: 'failed' }),
      record({
        action: 'transfer.saved',
        status: 'refused',
        decision: { request_id: 'req_1', outcome: 'deny', tier: 2, base_tier: 2, reasons: ['I_NO_PROOF'] },
      }),
      record({ action: 'transfer.saved', customer_id: 'cus_other' }),
      record({ action: 'fee.waive', created_at: Date.UTC(2025, 5, 1) }),
      record({ action: 'card.freeze' }),
      record({ action: 'bank.rob' }),
    ];
    const counters = gateCounters(records, 'cus_saksham', IN_PACK, T0 + 1000);
    expect(counters.transfers_last_10m).toBe(1);
    expect(counters.per_action_period['transfer.saved']).toEqual({ count: 2, amount_minor: 980000 });
    expect(counters.per_action_period['fee.waive']).toBeUndefined();
    expect(gateCounters(records, null, IN_PACK, T0)).toEqual({
      per_action_period: {},
      transfers_last_10m: 0,
    });
  });

  it('an approved step-up counts; a held or refused one does not', () => {
    const approved = record({
      action: 'transfer.saved',
      decision: {
        request_id: 'req_1',
        outcome: 'step_up',
        final_outcome: 'allow',
        tier: 3,
        base_tier: 2,
        reasons: ['P_TIER2'],
      },
      final_outcome: 'allow',
    });
    expect(countsAsUsed(approved)).toBe(true);
    expect(countsAsUsed({ ...approved, status: 'held' })).toBe(false);
    expect(
      countsAsUsed({
        ...approved,
        final_outcome: 'deny',
        decision: { ...approved.decision, final_outcome: 'deny' },
        status: 'refused',
      }),
    ).toBe(false);
  });

  it('an unknown bank outcome (reconcile handoff open) counts, a definite failure does not', () => {
    const allowed = record({ action: 'transfer.saved' });
    // Unknown: it may have executed, so limits treat it as used (fail closed: they only get stricter).
    expect(
      countsAsUsed({ ...allowed, status: 'failed', failure: 'E_FAIL_CLOSED', handoff_id: 'hnd_reconcile' }),
    ).toBe(true);
    // Refused by the bank, or never sent (no grant): nothing moved.
    expect(countsAsUsed({ ...allowed, status: 'failed', failure: 'E_CORE_REJECTED', handoff_id: null })).toBe(
      false,
    );
    expect(countsAsUsed({ ...allowed, status: 'failed', failure: 'E_FAIL_CLOSED', handoff_id: null })).toBe(
      false,
    );
  });

  it('Pass uses count in-scope allowed actions of that Pass only', () => {
    const viaPass = (action: string, pass_id = 'pass_demo') =>
      record({ action, pass_id, gate: { ...record({ action }).gate, proof: 'pass' } });
    const uses = passUses(
      [
        viaPass('emi.move_date'),
        viaPass('statement.view'),
        viaPass('statement.view', 'pass_other'),
        record({ action: 'card.freeze', pass_id: 'pass_demo' }),
        viaPass('bank.rob'),
      ],
      'pass_demo',
    );
    expect(uses).toEqual({ 'emi.move_date': 1, 'statement.view': 1 });
  });

  it('US limits use the US pack (no limit → nothing counted)', () => {
    expect(
      gateCounters([record({ action: 'card.freeze', region: 'US' })], 'cus_saksham', US_PACK, T0)
        .per_action_period,
    ).toEqual({});
  });
});

describe('who the caller names (never proof)', () => {
  const customer = (
    id: string,
    name: string,
    spoken: string,
    region: 'IN' | 'US' = 'IN',
  ): DirectoryCustomer => ({
    id,
    name,
    spoken_name: spoken,
    region,
    language: 'hi',
    number_hash: HASH,
    last4: '0003',
  });
  const all = [
    customer('cus_saksham', 'Saksham Mishra', 'सक्षम'),
    customer('cus_saksham_us', 'Saksham Mishra', 'सक्षम', 'US'),
    customer('cus_asha', 'Asha Rao', 'आशा'),
    customer('cus_asha2', 'Asha Verma', 'आशा वर्मा'),
  ];

  it('full name, spoken name or a unique first name, in the call’s region', () => {
    expect(customerByName(all, '  SAKSHAM   mishra! ', 'IN')?.id).toBe('cus_saksham');
    expect(customerByName(all, 'सक्षम', 'IN')?.id).toBe('cus_saksham');
    expect(customerByName(all, 'Saksham', 'US')?.id).toBe('cus_saksham_us');
    expect(customerByName(all, 'Asha', 'IN')).toBeNull();
    expect(customerByName(all, 'Asha Rao', 'IN')?.id).toBe('cus_asha');
    expect(customerByName(all, '!!!', 'IN')).toBeNull();
    expect(customerByName([...all, customer('cus_twin', 'Asha Rao', 'x')], 'Asha Rao', 'IN')).toBeNull();
  });

  it('normalising is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        expect(normalizeName(normalizeName(s))).toBe(normalizeName(s));
      }),
      { seed: 5, numRuns: 200 },
    );
  });
});

describe('events', () => {
  it('a refusal carries the code that decided it', () => {
    expect(primaryReason(['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER', 'C_DECLINED'])).toBe('C_DECLINED');
    expect(primaryReason(['P_HUMAN_ONLY', 'T_DISTRESS', 'H_SPECIALIST'])).toBe('T_DISTRESS');
    expect(primaryReason(['P_TIER0'])).toBe('P_TIER0');
    expect(primaryReason([])).toBe('E_FAIL_CLOSED');
  });

  it('the first event follows the outcome', () => {
    const base = { request_id: 'req_1', confirm: null };
    const decision = (outcome: 'allow' | 'step_up' | 'hold' | 'deny') => ({
      request_id: 'req_1',
      outcome,
      tier: 3,
      base_tier: 3,
      reasons: ['P_TIER3_STEP_UP' as const],
    });
    expect(proposalEvent({ ...base, decision: decision('allow') }).event).toBe('allow');
    expect(proposalEvent({ ...base, decision: decision('step_up') })).toEqual({
      event: 'step_up',
      properties: { request_id: 'req_1', channels: ['passkey'] },
    });
    expect(proposalEvent({ ...base, decision: decision('hold') }).event).toBe('hold');
    expect(proposalEvent({ ...base, decision: decision('deny') }).event).toBe('deny');
  });
});
