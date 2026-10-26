import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CORE_RESPONSES, CoreTransactionSchema } from './core';

const options = { seed: 20261027, numRuns: 300 };
const TXN = {
  id: 'txn_01JBK2W4Z8Q3N5R7T9V1X3Z5B7',
  kind: 'debit',
  category: 'transfer',
  amount: { amount_minor: 490000, currency: 'INR' },
  description: 'Transfer to Landlord',
  payee_id: 'payee_landlord',
  reference: 'AERO-X3Z5B7',
  created_at: '2026-10-27T04:30:00.000Z',
} as const;

describe('Aero Core response properties', () => {
  it('no non-integer amount ever passes as money (invariant 9)', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
        fc.constantFrom('INR', 'USD'),
        (amount, currency) =>
          !CoreTransactionSchema.safeParse({ ...TXN, amount: { amount_minor: amount, currency } }).success,
      ),
      options,
    );
  });

  it('a balance is any non-negative safe integer, never a fraction or a negative', () => {
    const balance = (amount_minor: number) =>
      CORE_RESPONSES['balance.view'].safeParse({
        action: 'balance.view',
        account: 'savings',
        balance: { amount_minor, currency: 'INR' },
        as_of: TXN.created_at,
      }).success;
    fc.assert(
      // ≤ 2^50 so that n + 0.5 is still a representable fraction.
      fc.property(
        fc.integer({ min: 0, max: 2 ** 50 }),
        (n) => balance(n) && (n === 0 || !balance(-n)) && !balance(n + 0.5),
      ),
      options,
    );
  });
});
