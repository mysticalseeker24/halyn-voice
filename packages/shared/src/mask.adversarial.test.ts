import { describe, expect, it } from 'vitest';
import { maskDeep, maskNumbers } from './mask';

// Test-engineer pass (Step 3): CLAUDE.md §6 says phone and account numbers are masked to the last 4 wherever Halyn
// persists or logs text. These are the formats agents, STT and people actually produce.

describe('maskNumbers: formats that must be masked', () => {
  it.each([
    ['E.164 with spaces', 'call +91 80653 56344', 'call ••••6344'],
    ['E.164 with dashes', '+1-415-555-0100', '••••0100'],
    ['a national number with dashes', '080-6535-6344', '••••6344'],
    ['a national number with spaces', 'my number is 98765 43210.', 'my number is ••••3210.'],
    ['an area code in parentheses', '(080) 6535 6344', '(••••6344'],
    ['a card number in groups', 'card 4111 1111 1111 1111', 'card ••••1111'],
    ['an 18-digit Indian account number', 'acct 123456789012345678', 'acct ••••5678'],
    ['a 17-digit account number', '12345678901234567', '••••4567'],
    ['Devanagari digits (Hindi STT)', 'नंबर +९१८०६५३५६३४४ है', 'नंबर ••••६३४४ है'],
    ['Devanagari digits with spaces', '९८७६५ ४३२१०', '••••३२१०'],
  ])('%s', (_, input, expected) => {
    expect(maskNumbers(input)).toBe(expected);
  });
});

describe('maskNumbers: text that must pass through unchanged', () => {
  it.each([
    ['an ISO time', '2026-10-26T10:00:00.000Z'],
    ['a date and a time of day', 'on 2026-10-26 10:30 IST'],
    ['a date with slashes', '26/10/2026'],
    ['a short spoken code', 'code 4 7 2 9 1 5'],
    ['a rupee amount', '₹4,80,000.50'],
    ['a dollar amount', '$8,000'],
    ['last 4 digits', 'card ending 8812'],
    ['a ULID', '01JBK2W4Z8Q3N5R7T9V1X3Z5B7'],
    ['a prefixed id with a digit run', 'req_0123456789ABCDEFGHJKMNPQ'],
    ['a SHA-256 hex starting with digits', `1234567890${'ab'.repeat(27)}`],
    ['an IFSC code', 'AERO0000001'],
    ['a 9-digit run', '123456789'],
    ['already masked text', '••••6344'],
  ])('%s', (_, text) => {
    expect(maskNumbers(text)).toBe(text);
  });
});

describe('maskDeep', () => {
  it('reaches strings inside nested arrays and objects, and is idempotent', () => {
    const input = { a: [['+91 80653 56344', 7], { b: ['080-6535-6344'] }], n: 9876543210 };
    const once = maskDeep(input);
    expect(once).toEqual({ a: [['••••6344', 7], { b: ['••••6344'] }], n: 9876543210 });
    expect(maskDeep(once)).toEqual(once);
  });
});
