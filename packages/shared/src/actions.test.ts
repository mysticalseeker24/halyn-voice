import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  ACTION_PARAMS,
  type ActionId,
  actionAmount,
  ActionIdSchema,
  carriesAmount,
  CRITICAL_ACTIONS,
  isCriticalAction,
  MONEY_MOVING_ACTIONS,
  movesMoney,
  parseActionParams,
  ProposedActionSchema,
} from './actions';

// One valid example per action. Scenario examples come first where tests/scenarios/scenarios.yaml has one.
const SAMPLES: Record<ActionId, Record<string, unknown>> = {
  'card.freeze': { card_last4: '8812' },
  'balance.view': { account: 'savings' },
  'statement.view': { account: 'savings' },
  'fee.waive': { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' },
  'emi.move_date': { loan_id: 'loan_personal_1', new_day: 10 },
  'transfer.saved': { amount_minor: 1000000, currency: 'INR', payee_id: 'payee_mom' },
  'transfer.new_payee': {
    amount_minor: 4500000,
    currency: 'INR',
    payee_account_last4: '4471',
    payee_ifsc: 'AERO0000001',
  },
  'upi.raise_limit': { amount_minor: 20000000, currency: 'INR' },
  'card.reset_pin': { card_last4: '8812' },
  'profile.change_mobile': { new_number: '+919000000003' },
  'profile.change_email': { new_email: 'saksham@example.com' },
  'dispute.charge': { card_last4: '8812', amount_minor: 250000, currency: 'INR', merchant: 'Example Store' },
  'account.close': { account: 'savings' },
  'account.add_owner': { account: 'savings', owner_name: 'Asha Mishra' },
  'loan.new': { amount_minor: 50000000, currency: 'INR', tenure_months: 24 },
  'wire.international': {
    amount_minor: 500000,
    currency: 'USD',
    payee_account_last4: '3310',
    swift_bic: 'AEROUS33',
    payee_country: 'GB',
  },
  'wire.new': { amount_minor: 800000, currency: 'USD', payee_account_last4: '3310', routing_last4: '0021' },
};

describe('action registry', () => {
  it('lists the 17 actions of both packs exactly once', () => {
    expect(ACTION_IDS).toHaveLength(17);
    expect(new Set(ACTION_IDS).size).toBe(17);
    expect(Object.keys(ACTION_PARAMS).sort()).toEqual([...ACTION_IDS].sort());
    expect(ActionIdSchema.safeParse('card.melt').success).toBe(false);
  });

  it.each(ACTION_IDS)('%s has a strict params schema', (action) => {
    expect(parseActionParams(action, SAMPLES[action]).ok).toBe(true);
    expect(parseActionParams(action, { ...SAMPLES[action], extra: 1 }).ok).toBe(false);
    expect(parseActionParams(action, {}).ok).toBe(false);
  });

  it('marks money-moving and amount-carrying actions', () => {
    expect([...MONEY_MOVING_ACTIONS].sort()).toEqual(
      [
        'loan.new',
        'transfer.new_payee',
        'transfer.saved',
        'upi.raise_limit',
        'wire.international',
        'wire.new',
      ].sort(),
    );
    expect(movesMoney('transfer.saved')).toBe(true);
    expect(movesMoney('card.freeze')).toBe(false);
    expect(carriesAmount('fee.waive')).toBe(true);
    expect(carriesAmount('dispute.charge')).toBe(true);
    expect(carriesAmount('emi.move_date')).toBe(false);
  });

  it('marks the critical actions that a Pass can never hold (invariant 5)', () => {
    expect([...CRITICAL_ACTIONS].sort()).toEqual(
      [
        'account.add_owner',
        'account.close',
        'profile.change_email',
        'profile.change_mobile',
        'transfer.new_payee',
        'wire.international',
        'wire.new',
      ].sort(),
    );
    expect(isCriticalAction('wire.new')).toBe(true);
    expect(isCriticalAction('card.freeze')).toBe(false);
  });
});

describe('parseActionParams', () => {
  it('returns a typed proposal', () => {
    const parsed = parseActionParams('transfer.new_payee', {
      ...SAMPLES['transfer.new_payee'],
      payee_name: 'RBI verification account',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        action: 'transfer.new_payee',
        params: { ...SAMPLES['transfer.new_payee'], payee_name: 'RBI verification account' },
      },
    });
  });

  it.each([
    ['an unknown action', 'card.melt', { card_last4: '8812' }],
    ['a fractional amount', 'fee.waive', { ...SAMPLES['fee.waive'], amount_minor: 600.5 }],
    ['a negative amount', 'transfer.saved', { ...SAMPLES['transfer.saved'], amount_minor: -1 }],
    ['a zero amount', 'transfer.saved', { ...SAMPLES['transfer.saved'], amount_minor: 0 }],
    ['an amount as a string', 'transfer.saved', { ...SAMPLES['transfer.saved'], amount_minor: '1000000' }],
    ['a bad IFSC', 'transfer.new_payee', { ...SAMPLES['transfer.new_payee'], payee_ifsc: 'AER00000001' }],
    [
      'a full account number',
      'transfer.new_payee',
      { ...SAMPLES['transfer.new_payee'], payee_account_last4: '12344471' },
    ],
    ['an EMI day past the 28th', 'emi.move_date', { loan_id: 'loan_personal_1', new_day: 29 }],
    ['an unknown currency', 'wire.new', { ...SAMPLES['wire.new'], currency: 'EUR' }],
    ['params that are not an object', 'card.freeze', '8812'],
  ])('rejects %s', (_, action, params) => {
    const parsed = parseActionParams(action, params);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(0);
  });

  // A JSON body may carry an own "__proto__" key; Zod object/record parsing assigns it as the prototype, so the key
  // vanishes and its fields become inherited (params.admin === true). Strict params must reject it instead.
  it('rejects an own "__proto__" key from a JSON body', () => {
    const params = JSON.parse('{"card_last4":"8812","__proto__":{"admin":true}}') as unknown;
    expect(parseActionParams('card.freeze', params).ok).toBe(false);
  });

  it('rejects params whose prototype is not a plain object (what an earlier record parse leaves behind)', () => {
    const params = Object.assign(Object.create({ admin: true }) as object, { card_last4: '8812' });
    expect(parseActionParams('card.freeze', params).ok).toBe(false);
  });

  it('accepts a null-prototype object', () => {
    const params = Object.assign(Object.create(null) as object, { card_last4: '8812' });
    expect(parseActionParams('card.freeze', params).ok).toBe(true);
  });
});

describe('actionAmount', () => {
  it('reads the amount of money-carrying actions', () => {
    const proposal = ProposedActionSchema.parse({ action: 'wire.new', params: SAMPLES['wire.new'] });
    expect(actionAmount(proposal)).toEqual({ amount_minor: 800000, currency: 'USD' });
  });
  it('is null for actions without an amount', () => {
    const proposal = ProposedActionSchema.parse({ action: 'card.freeze', params: SAMPLES['card.freeze'] });
    expect(actionAmount(proposal)).toBeNull();
  });
});
