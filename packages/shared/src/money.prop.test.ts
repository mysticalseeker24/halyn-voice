import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMoney, type Currency, formatMoney, type Money, MoneySchema, parseMoney } from './money';

const currency = fc.constantFrom<Currency>('INR', 'USD');
const options = { seed: 20261026, numRuns: 500 };

describe('money properties', () => {
  it('format → parse round-trips every safe integer amount', () => {
    fc.assert(
      fc.property(
        fc.maxSafeInteger(),
        currency,
        fc.constantFrom('auto' as const, 'always' as const),
        fc.boolean(),
        (amount, c, minor, symbol) => {
          const money: Money = { amount_minor: amount, currency: c };
          expect(parseMoney(formatMoney(money, { minor, symbol }), c, { allowNegative: true })).toEqual(
            money,
          );
        },
      ),
      options,
    );
  });

  it('MoneySchema rejects every non-integer number', () => {
    fc.assert(
      fc.property(
        fc.double().filter((d) => !Number.isInteger(d)),
        currency,
        (amount, c) => {
          expect(MoneySchema.safeParse({ amount_minor: amount, currency: c }).success).toBe(false);
        },
      ),
      options,
    );
  });

  it('sums stay exact integers (checked against BigInt)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -(2 ** 40), max: 2 ** 40 }), { maxLength: 50 }),
        currency,
        (xs, c) => {
          const total = xs.reduce<Money>((acc, x) => addMoney(acc, { amount_minor: x, currency: c }), {
            amount_minor: 0,
            currency: c,
          });
          expect(Number.isSafeInteger(total.amount_minor)).toBe(true);
          expect(BigInt(total.amount_minor)).toBe(xs.reduce((a, x) => a + BigInt(x), 0n));
        },
      ),
      options,
    );
  });
});
