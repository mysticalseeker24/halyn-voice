import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from './canonical-json';
import { maskDeep, maskNumbers } from './mask';

describe('maskNumbers', () => {
  it.each([
    ['+918065356344', '••••6344'],
    ['call +14155550100 now', 'call ••••0100 now'],
    ['9876543210', '••••3210'],
    ['acct 123456789012', 'acct ••••9012'],
    ['from +918065356344 to +918065356379', 'from ••••6344 to ••••6379'],
  ])('masks %j', (text, masked) => {
    expect(maskNumbers(text)).toBe(masked);
  });

  it.each([
    ['a ULID id', 'pass_01JBK2W4Z8Q3N5R7T9V1X3Z5B7'],
    ['a bare ULID', '01JBK2W4Z8Q3N5R7T9V1X3Z5B7'],
    ['a SHA-256 hex', '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'],
    ['an ISO time', '2026-10-26T10:00:00.000Z'],
    ['a rupee amount', '₹4,80,000'],
    ['last 4 digits', 'card ending 8812'],
    ['an IFSC code', 'AERO0000001'],
    ['a 9-digit run', '123456789'],
  ])('leaves %s unchanged', (_, text) => {
    expect(maskNumbers(text)).toBe(text);
  });
});

describe('maskDeep', () => {
  it('masks every string at any depth and leaves numbers, booleans, null and keys alone', () => {
    const input = {
      from: '+918065356344',
      amount_minor: 4500000,
      nested: [{ to: 'number 9876543210' }, true, null],
      '+918065356344': 'key stays',
    };
    expect(maskDeep(input)).toEqual({
      from: '••••6344',
      amount_minor: 4500000,
      nested: [{ to: 'number ••••3210' }, true, null],
      '+918065356344': 'key stays',
    });
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 3 }), (value) => {
        const once = maskDeep(value as JsonValue);
        expect(maskDeep(once)).toEqual(once);
      }),
      { seed: 3003, numRuns: 300 },
    );
  });

  it('never leaves an E.164 number behind', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.stringMatching(/^\+[1-9]\d{9,13}$/), (prefix, phone) => {
        expect(maskNumbers(`${prefix} ${phone}`)).not.toContain(phone);
      }),
      { seed: 3004, numRuns: 300 },
    );
  });
});
