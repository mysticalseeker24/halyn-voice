import { describe, expect, it } from 'vitest';
import { ACTION_IDS, ACTION_PARAMS } from './actions';
import {
  CORE_ACTION_IDS,
  CORE_RESPONSES,
  CORE_ROUTES,
  CoreOutcomeDetailsSchema,
  CoreReferenceSchema,
  coreEndpoints,
  coreRoute,
  CoreTransactionSchema,
  isCoreAction,
} from './core';

const AT = '2026-10-27T04:30:00.000Z';
const TXN = {
  id: 'txn_01JBK2W4Z8Q3N5R7T9V1X3Z5B7',
  kind: 'debit',
  category: 'transfer',
  amount: { amount_minor: 490000, currency: 'INR' },
  description: 'Transfer to Landlord',
  payee_id: 'payee_landlord',
  reference: 'AERO-X3Z5B7',
  created_at: AT,
} as const;

describe('CORE_ROUTES (docs/ACTIONS.md, Aero Core column)', () => {
  it('maps exactly the actions Aero Core executes', () => {
    expect(CORE_ROUTES).toEqual({
      'balance.view': { method: 'GET', path: '/core/balance' },
      'card.freeze': { method: 'POST', path: '/core/cards/freeze' },
      'emi.move_date': { method: 'POST', path: '/core/loans/emi-date' },
      'fee.waive': { method: 'POST', path: '/core/fees/waive' },
      'statement.view': { method: 'GET', path: '/core/statement' },
      'transfer.new_payee': { method: 'POST', path: '/core/transfers' },
      'transfer.saved': { method: 'POST', path: '/core/transfers' },
      'wire.new': { method: 'POST', path: '/core/transfers' },
    });
  });

  it('lists the core actions in ActionId order', () => {
    expect(CORE_ACTION_IDS).toEqual(ACTION_IDS.filter((a) => a in CORE_ROUTES));
  });

  it('coreRoute returns the route, or null for actions with no Aero Core route', () => {
    expect(coreRoute('card.freeze')).toEqual({ method: 'POST', path: '/core/cards/freeze' });
    for (const action of [
      'upi.raise_limit',
      'card.reset_pin',
      'profile.change_mobile',
      'account.close',
    ] as const)
      expect(coreRoute(action)).toBeNull();
  });

  it('isCoreAction accepts only own keys (no prototype names, no unknown actions)', () => {
    expect(isCoreAction('wire.new')).toBe(true);
    for (const value of ['toString', '__proto__', 'constructor', 'account.close', '', 'wire.new '])
      expect(isCoreAction(value)).toBe(false);
  });

  it('GET routes take only string or enum params (a query string carries strings only)', () => {
    const gets = CORE_ACTION_IDS.filter((action) => CORE_ROUTES[action].method === 'GET');
    expect(gets).toEqual(['balance.view', 'statement.view']);
    for (const action of gets) {
      const fields = Object.entries(ACTION_PARAMS[action].shape);
      expect(fields.length, action).toBeGreaterThan(0);
      for (const [key, field] of fields)
        expect(['string', 'enum'], `${action}.${key}`).toContain(field.def.type);
    }
  });

  it('groups actions by endpoint: one route can serve several actions', () => {
    expect(coreEndpoints()).toEqual([
      { method: 'GET', path: '/core/balance', actions: ['balance.view'] },
      { method: 'POST', path: '/core/cards/freeze', actions: ['card.freeze'] },
      { method: 'POST', path: '/core/loans/emi-date', actions: ['emi.move_date'] },
      { method: 'POST', path: '/core/fees/waive', actions: ['fee.waive'] },
      { method: 'GET', path: '/core/statement', actions: ['statement.view'] },
      {
        method: 'POST',
        path: '/core/transfers',
        actions: ['transfer.new_payee', 'transfer.saved', 'wire.new'],
      },
    ]);
  });
});

describe('Aero Core response schemas', () => {
  it('accepts each documented response shape', () => {
    const balance = { amount_minor: 52_000_000, currency: 'INR' };
    const samples = {
      'card.freeze': {
        action: 'card.freeze',
        reference: 'AERO-X3Z5B7',
        card: { last4: '8812', status: 'frozen' },
        already_frozen: false,
      },
      'fee.waive': {
        action: 'fee.waive',
        reference: 'AERO-X3Z5B7',
        fee: { id: 'fee_late_oct', status: 'waived', amount: { amount_minor: 60000, currency: 'INR' } },
        balance,
      },
      'emi.move_date': {
        action: 'emi.move_date',
        reference: 'AERO-X3Z5B7',
        loan: { id: 'loan_personal_1', emi_day: 10, previous_emi_day: 5 },
      },
      'transfer.saved': { action: 'transfer.saved', reference: 'AERO-X3Z5B7', transaction: TXN, balance },
      'transfer.new_payee': {
        action: 'transfer.new_payee',
        reference: 'AERO-X3Z5B7',
        transaction: TXN,
        balance,
      },
      'wire.new': {
        action: 'wire.new',
        reference: 'AERO-X3Z5B7',
        transaction: { ...TXN, category: 'wire', amount: { amount_minor: 800000, currency: 'USD' } },
        balance: { amount_minor: 445000, currency: 'USD' },
      },
      'balance.view': { action: 'balance.view', account: 'savings', balance, as_of: AT },
      'statement.view': {
        action: 'statement.view',
        account: 'savings',
        account_last4: '3094',
        balance,
        transactions: [TXN, { ...TXN, kind: 'credit', category: 'salary', payee_id: null, reference: null }],
        cards: [{ last4: '8812', status: 'frozen' }],
        loans: [
          {
            id: 'loan_personal_1',
            emi: { amount_minor: 1250000, currency: 'INR' },
            emi_day: 5,
            outstanding: { amount_minor: 18750000, currency: 'INR' },
            status: 'active',
          },
        ],
        as_of: AT,
      },
    } as const;
    for (const action of CORE_ACTION_IDS) {
      const parsed = CORE_RESPONSES[action].safeParse(samples[action]);
      expect(parsed.success, action).toBe(true);
    }
  });

  it('is strict: extra keys, another action, or a negative balance are rejected', () => {
    const ok = {
      action: 'balance.view',
      account: 'savings',
      balance: { amount_minor: 1, currency: 'INR' },
      as_of: AT,
    };
    expect(CORE_RESPONSES['balance.view'].safeParse(ok).success).toBe(true);
    expect(CORE_RESPONSES['balance.view'].safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(CORE_RESPONSES['balance.view'].safeParse({ ...ok, action: 'statement.view' }).success).toBe(false);
    expect(
      CORE_RESPONSES['balance.view'].safeParse({ ...ok, balance: { amount_minor: -1, currency: 'INR' } })
        .success,
    ).toBe(false);
    expect(CORE_RESPONSES['transfer.saved'].safeParse({ action: 'wire.new' }).success).toBe(false);
  });

  it('outcome details: executed (with what to reconcile by) or unknown', () => {
    const executed = {
      outcome: 'executed',
      reference: 'AERO-X3Z5B7',
      request_id: 'req_01JBK2W4Z8Q3N5R7T9V1X3Z5B7',
      used_at: AT,
    } as const;
    expect(CoreOutcomeDetailsSchema.parse(executed)).toEqual(executed);
    expect(CoreOutcomeDetailsSchema.parse({ outcome: 'unknown' })).toEqual({ outcome: 'unknown' });
    for (const bad of [
      { ...executed, reference: 'X-1' },
      { ...executed, used_at: 'yesterday' },
      { ...executed, extra: 1 },
      { outcome: 'executed', reference: 'AERO-X3Z5B7' },
      { outcome: 'unknown', reference: 'AERO-X3Z5B7' },
      { outcome: 'maybe' },
      {},
    ])
      expect(CoreOutcomeDetailsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('references are AERO- plus 6 Crockford base32 characters', () => {
    expect(CoreReferenceSchema.safeParse('AERO-7K3M9Q').success).toBe(true);
    for (const bad of ['AERO-7K3M9', 'AERO-7K3M9QX', 'aero-7k3m9q', 'AERO-7K3M9I', 'AERO-7K3MOQ', 'X-7K3M9Q'])
      expect(CoreReferenceSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('a transaction amount is a positive integer (invariant 9)', () => {
    expect(CoreTransactionSchema.safeParse(TXN).success).toBe(true);
    for (const amount of [0, -100, 1.5])
      expect(
        CoreTransactionSchema.safeParse({ ...TXN, amount: { amount_minor: amount, currency: 'INR' } })
          .success,
      ).toBe(false);
  });
});
