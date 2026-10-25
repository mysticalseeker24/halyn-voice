import { z } from 'zod';
import { HalynError } from './errors';

// Money is integer minor units + currency (invariant 9). Nothing here divides or multiplies by 100:
// formatting and parsing work on decimal digit strings, so no value ever passes through a float.

export const CURRENCIES = ['INR', 'USD'] as const;
export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

/** Both currencies have 2 minor digits (paise, cents). */
export const MINOR_DIGITS = 2;
const SYMBOL: Record<Currency, string> = { INR: '₹', USD: '$' };

/** Safe integer minor units. Negative only for balances; action amounts use the positive schema. */
export const AmountMinorSchema = z.int();
export const PositiveAmountMinorSchema = z.int().positive();

export const MoneySchema = z.strictObject({ amount_minor: AmountMinorSchema, currency: CurrencySchema });
export const PositiveMoneySchema = z.strictObject({
  amount_minor: PositiveAmountMinorSchema,
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

function failClosed(message: string): never {
  throw new HalynError('E_FAIL_CLOSED', message);
}

function checked(money: Money): Money {
  const parsed = MoneySchema.safeParse(money);
  if (!parsed.success) failClosed(`invalid money: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Indian grouping: last three digits, then pairs (4,80,000 · 1,23,45,678). */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const groups = [whole.slice(-3)];
  let rest = whole.slice(0, -3);
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  groups.unshift(rest);
  return groups.join(',');
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatMoneyOptions {
  /** 'auto' (default) drops `.00` on whole amounts; 'always' keeps the minor digits. */
  minor?: 'auto' | 'always';
  /** Prefix ₹ / $ (default true). */
  symbol?: boolean;
}

/** `₹4,80,000`, `₹1,23,45,678.50`, `$8,000`, `-₹600.50`. Fails closed on anything but safe integers. */
export function formatMoney(money: Money, options: FormatMoneyOptions = {}): string {
  const { amount_minor, currency } = checked(money);
  const digits = String(Math.abs(amount_minor)).padStart(MINOR_DIGITS + 1, '0');
  const whole = digits.slice(0, -MINOR_DIGITS);
  const minor = digits.slice(-MINOR_DIGITS);
  const grouped = currency === 'INR' ? groupIndian(whole) : groupThousands(whole);
  const fraction = options.minor === 'always' || minor !== '00' ? `.${minor}` : '';
  const sign = amount_minor < 0 ? '-' : '';
  return `${sign}${options.symbol === false ? '' : SYMBOL[currency]}${grouped}${fraction}`;
}

const SHAPE = /^(-)?([₹$])?([0-9,]+)(?:\.([0-9]{1,2}))?$/;
const PLAIN = /^(?:0|[1-9][0-9]*)$/;
const GROUPED: Record<Currency, RegExp> = {
  INR: /^[1-9][0-9]?(?:,[0-9]{2})*,[0-9]{3}$/,
  USD: /^[1-9][0-9]{0,2}(?:,[0-9]{3})+$/,
};

export interface ParseMoneyOptions {
  allowNegative?: boolean;
}

/**
 * Parse an amount written the way `formatMoney` writes it (symbol and grouping optional, at most two
 * decimals). Rejects exponents, wrong symbols or grouping, leading zeros, negatives (unless allowed) and
 * anything outside the safe-integer range.
 */
export function parseMoney(text: string, currency: Currency, options: ParseMoneyOptions = {}): Money {
  if (!CurrencySchema.safeParse(currency).success) failClosed(`unknown currency ${String(currency)}`);
  const match = SHAPE.exec(text.trim());
  if (!match) return failClosed(`not an amount: "${text}"`);
  const [, minus, symbol, whole = '', fraction = ''] = match;
  if (minus && !options.allowNegative) failClosed(`negative amount not allowed: "${text}"`);
  if (symbol !== undefined && symbol !== SYMBOL[currency])
    failClosed(`"${text}" is not written in ${currency}`);
  if (!PLAIN.test(whole) && !GROUPED[currency].test(whole))
    failClosed(`bad digit grouping for ${currency}: "${text}"`);
  const minorUnits = BigInt(whole.replaceAll(',', '') + fraction.padEnd(MINOR_DIGITS, '0'));
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) failClosed(`amount out of range: "${text}"`);
  const amount = Number(minorUnits);
  return { amount_minor: minus && amount !== 0 ? -amount : amount, currency };
}

function sameCurrency(a: Money, b: Money): Currency {
  const x = checked(a);
  const y = checked(b);
  if (x.currency !== y.currency) failClosed(`currency mismatch: ${x.currency} vs ${y.currency}`);
  return x.currency;
}

export function addMoney(a: Money, b: Money): Money {
  const currency = sameCurrency(a, b);
  const sum = a.amount_minor + b.amount_minor;
  if (!Number.isSafeInteger(sum)) failClosed('amount overflow');
  return { amount_minor: sum, currency };
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  if (a.amount_minor === b.amount_minor) return 0;
  return a.amount_minor < b.amount_minor ? -1 : 1;
}
