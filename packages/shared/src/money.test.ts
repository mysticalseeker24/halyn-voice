import { describe, expect, it } from 'vitest';
import { HalynError } from './errors';
import {
  addMoney,
  compareMoney,
  type Currency,
  formatMoney,
  type Money,
  MoneySchema,
  parseMoney,
  PositiveMoneySchema,
} from './money';

function expectFailClosed(fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HalynError);
    expect((err as HalynError).code).toBe('E_FAIL_CLOSED');
    return;
  }
  throw new Error('expected a HalynError');
}

const inr = (amount_minor: number): Money => ({ amount_minor, currency: 'INR' });
const usd = (amount_minor: number): Money => ({ amount_minor, currency: 'USD' });

describe('formatMoney', () => {
  it.each([
    [inr(60000), '₹600'],
    [inr(4500000), '₹45,000'],
    [inr(48000000), '₹4,80,000'],
    [inr(1234567850), '₹1,23,45,678.50'],
    [inr(99), '₹0.99'],
    [inr(5), '₹0.05'],
    [inr(0), '₹0'],
    [inr(-60050), '-₹600.50'],
    [usd(800000), '$8,000'],
    [usd(123456789), '$1,234,567.89'],
    [usd(Number.MAX_SAFE_INTEGER), '$90,071,992,547,409.91'],
  ])('%o → %s', (money, text) => expect(formatMoney(money)).toBe(text));

  it('can always show minor digits and drop the symbol', () => {
    expect(formatMoney(inr(60000), { minor: 'always' })).toBe('₹600.00');
    expect(formatMoney(inr(48000000), { symbol: false })).toBe('4,80,000');
  });

  it('fails closed on non-integer or unsafe amounts', () => {
    expectFailClosed(() => formatMoney(inr(1.5)));
    expectFailClosed(() => formatMoney(inr(2 ** 53)));
    expectFailClosed(() => formatMoney({ amount_minor: 1, currency: 'EUR' } as unknown as Money));
  });
});

describe('parseMoney', () => {
  it.each([
    ['₹4,80,000', 'INR', 48000000],
    ['4,80,000', 'INR', 48000000],
    ['480000', 'INR', 48000000],
    ['12,345', 'INR', 1234500],
    ['₹600.5', 'INR', 60050],
    [' ₹600 ', 'INR', 60000],
    ['0.05', 'INR', 5],
    ['$8,000', 'USD', 800000],
    ['8000.00', 'USD', 800000],
    ['1,234,567.89', 'USD', 123456789],
  ] as const)('%s (%s) → %d', (text, currency, amount) =>
    expect(parseMoney(text, currency)).toEqual({ amount_minor: amount, currency }),
  );

  it.each([
    ['600.505', 'INR'],
    ['1e3', 'INR'],
    ['₹600', 'USD'],
    ['$8,000', 'INR'],
    ['4,80,000', 'USD'],
    ['480,000', 'INR'],
    ['1,00', 'INR'],
    ['-600', 'INR'],
    ['', 'INR'],
    ['600.', 'INR'],
    ['.5', 'INR'],
    ['00600', 'INR'],
    ['NaN', 'USD'],
    ['Infinity', 'USD'],
    ['90071992547409.92', 'USD'],
  ] as const)('rejects %j (%s)', (text, currency) => expectFailClosed(() => parseMoney(text, currency)));

  it('fails closed on an unknown currency', () => {
    expectFailClosed(() => parseMoney('600', 'EUR' as Currency));
  });

  it('accepts negatives only when asked, and never returns -0', () => {
    expect(parseMoney('-₹600', 'INR', { allowNegative: true })).toEqual(inr(-60000));
    expect(Object.is(parseMoney('-0', 'INR', { allowNegative: true }).amount_minor, 0)).toBe(true);
  });
});

describe('arithmetic', () => {
  it('adds and compares within one currency', () => {
    expect(addMoney(inr(100), inr(250))).toEqual(inr(350));
    expect(compareMoney(inr(100), inr(250))).toBe(-1);
    expect(compareMoney(inr(250), inr(250))).toBe(0);
    expect(compareMoney(usd(300), usd(250))).toBe(1);
  });
  it('fails closed on currency mismatch or overflow', () => {
    expectFailClosed(() => addMoney(inr(1), usd(1)));
    expectFailClosed(() => compareMoney(inr(1), usd(1)));
    expectFailClosed(() => addMoney(usd(Number.MAX_SAFE_INTEGER), usd(1)));
  });
});

describe('MoneySchema', () => {
  it('accepts integer minor units (negative for balances)', () => {
    expect(MoneySchema.parse(inr(-500))).toEqual(inr(-500));
  });
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '100'])('rejects amount %s', (amount) =>
    expect(MoneySchema.safeParse({ amount_minor: amount, currency: 'INR' }).success).toBe(false),
  );
  it('rejects unknown currencies and extra keys', () => {
    expect(MoneySchema.safeParse({ amount_minor: 1, currency: 'EUR' }).success).toBe(false);
    expect(MoneySchema.safeParse({ ...inr(1), note: 'x' }).success).toBe(false);
  });
  it('PositiveMoneySchema rejects zero and negatives', () => {
    expect(PositiveMoneySchema.safeParse(inr(1)).success).toBe(true);
    expect(PositiveMoneySchema.safeParse(inr(0)).success).toBe(false);
    expect(PositiveMoneySchema.safeParse(inr(-1)).success).toBe(false);
  });
});
