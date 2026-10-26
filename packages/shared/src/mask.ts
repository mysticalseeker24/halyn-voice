import type { JsonValue } from './canonical-json';

// Phone and account numbers are masked to the last 4 digits wherever Halyn persists or logs text (CLAUDE.md §6).
// Ids, ULIDs, hashes, ISO times and amounts are left alone: digits glued to letters or other digits are not numbers.

const MASK = '••••';
// ASCII and Devanagari digits (Hindi STT writes ०–९).
const DIGIT = '[0-9०-९]';
// A candidate: an optional +, then 7–18 digits that may be split by up to two spaces, dashes or parentheses each
// ("+91 80653 56344", "080-6535-6344", "(080) 6535 6344", "4111 1111 1111 1111"). It may not be glued to a letter or
// digit on either side, nor followed by ":" (a time of day such as "10:30").
const CANDIDATE = new RegExp(
  `(?<![\\p{L}\\p{N}])\\+?${DIGIT}(?:[ ()-]{0,2}${DIGIT}){6,17}(?![\\p{L}\\p{N}:])`,
  'gu',
);
const DIGITS = new RegExp(DIGIT, 'gu');

/** E.164 (+ and 7–15 digits) or 10–18 digits: phone, card and Indian account numbers. Shorter runs are left alone. */
function isNumber(match: string, digits: number): boolean {
  return match.startsWith('+') ? digits >= 7 && digits <= 15 : digits >= 10 && digits <= 18;
}

export function maskNumbers(text: string): string {
  return text.replace(CANDIDATE, (match) => {
    const digits = [...match.matchAll(DIGITS)].map((m) => m[0]);
    return isNumber(match, digits.length) ? MASK + digits.slice(-4).join('') : match;
  });
}

/** Mask every string value at any depth. Keys, numbers, booleans and null pass through. Idempotent. */
export function maskDeep(value: JsonValue): JsonValue {
  if (typeof value === 'string') return maskNumbers(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  return value;
}
