import { describe, expect, it } from 'vitest';
import { seededRng } from './__fixtures__/rng';
import { fixedClock } from './clock';
import { HalynError } from './errors';
import {
  Base64UrlSchema,
  E164Schema,
  Hex64Schema,
  IdSchema,
  IsoDateTimeSchema,
  Last4Schema,
  newId,
  newUlid,
  PassIdSchema,
  prefixedId,
  RunIdSchema,
  ScenarioIdSchema,
  UlidSchema,
  UnixSecondsSchema,
} from './ids';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe('UlidSchema', () => {
  it('accepts Crockford base32 ULIDs', () => {
    expect(ok(UlidSchema, '01J9Z8X7W6V5T4S3R2Q1P0N9M8')).toBe(true);
    expect(ok(UlidSchema, '7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true);
  });
  it.each([
    ['too short', '01J9Z8X7W6V5T4S3R2Q1P0N9M'],
    ['lower case', '01j9z8x7w6v5t4s3r2q1p0n9m8'],
    ['excluded letter I', '01J9Z8X7W6V5T4S3R2Q1P0N9MI'],
    ['excluded letter U', '01J9Z8X7W6V5T4S3R2Q1P0N9MU'],
    ['timestamp overflow', '81J9Z8X7W6V5T4S3R2Q1P0N9M8'],
  ])('rejects %s', (_, v) => expect(ok(UlidSchema, v)).toBe(false));
});

describe('IdSchema and prefixedId', () => {
  it.each([
    'ten_aero',
    'cus_saksham_us',
    'pass_01J9Z8X7W6V5T4S3R2Q1P0N9M8',
    'loan_personal_1',
    'fee_late_oct',
  ])('accepts %s', (v) => expect(ok(IdSchema, v)).toBe(true));
  it.each(['Ten_aero', 'aero', '_x', 'cus_', 'cus-x', `cus_${'a'.repeat(61)}`])('rejects %s', (v) =>
    expect(ok(IdSchema, v)).toBe(false),
  );
  it('pins the prefix', () => {
    const CustomerId = prefixedId('cus');
    expect(ok(CustomerId, 'cus_saksham')).toBe(true);
    expect(ok(CustomerId, 'ten_aero')).toBe(false);
    expect(ok(CustomerId, 'cus_')).toBe(false);
    expect(() => prefixedId('Cus')).toThrow();
  });
});

describe('newUlid and newId', () => {
  const T = Date.UTC(2026, 9, 26, 10, 0, 0);
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const decodeTime = (ulid: string) =>
    [...ulid.slice(0, 10)].reduce((acc, c) => acc * 32 + ENCODING.indexOf(c), 0);

  it('makes a valid ULID whose first 10 characters encode the clock', () => {
    const id = newUlid(fixedClock(T), seededRng(1));
    expect(ok(UlidSchema, id)).toBe(true);
    expect(decodeTime(id)).toBe(T);
  });

  it('takes its 80 random bits from the rng', () => {
    const a = newUlid(fixedClock(T), seededRng(1));
    const b = newUlid(fixedClock(T), seededRng(2));
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a.slice(10)).not.toBe(b.slice(10));
    expect(newUlid(fixedClock(T), seededRng(1))).toBe(a);
    const zeros = newUlid(fixedClock(0), { bytes: (n) => new Uint8Array(n) });
    expect(zeros).toBe('0'.repeat(26));
    const ones = newUlid(fixedClock(2 ** 48 - 1), { bytes: (n) => new Uint8Array(n).fill(255) });
    expect(ones).toBe(`7${'Z'.repeat(25)}`);
  });

  it('builds prefixed ids', () => {
    const id = newId('pass', fixedClock(T), seededRng(3));
    expect(ok(PassIdSchema, id)).toBe(true);
    expect(ok(UlidSchema, id.slice(5))).toBe(true);
  });

  it('fails closed on a clock outside 48 bits, a short rng or a bad prefix', () => {
    expect(() => newUlid({ nowMs: () => 2 ** 48 }, seededRng(1))).toThrow(HalynError);
    expect(() => newUlid({ nowMs: () => -1 }, seededRng(1))).toThrow(HalynError);
    expect(() => newUlid(fixedClock(T), { bytes: () => new Uint8Array(4) })).toThrow(HalynError);
    expect(() => newId('Bad', fixedClock(T), seededRng(1))).toThrow(HalynError);
  });
});

describe('formats', () => {
  it('E164', () => {
    expect(ok(E164Schema, '+918065356379')).toBe(true);
    expect(ok(E164Schema, '+14155550100')).toBe(true);
    for (const bad of ['918065356379', '+0123456', '+91 80653 56379', '+1234567890123456', '+12345'])
      expect(ok(E164Schema, bad)).toBe(false);
  });
  it('scenario id: 1–12 and 3b only', () => {
    for (const id of ['1', '3', '3b', '9', '10', '12']) expect(ok(ScenarioIdSchema, id)).toBe(true);
    for (const bad of ['0', '13', '5b', '12b', '03', '3B', '']) expect(ok(ScenarioIdSchema, bad)).toBe(false);
  });
  it('run id', () => {
    expect(ok(RunIdSchema, 'b1f6c8e2-7d3a-4c1e-9f00-123456789abc')).toBe(true);
    expect(ok(RunIdSchema, '')).toBe(false);
    expect(ok(RunIdSchema, 'x'.repeat(129))).toBe(false);
  });
  it('hex64, last4, unix seconds, ISO time, base64url', () => {
    expect(ok(Hex64Schema, 'ab'.repeat(32))).toBe(true);
    expect(ok(Hex64Schema, 'AB'.repeat(32))).toBe(false);
    expect(ok(Hex64Schema, 'a'.repeat(63))).toBe(false);
    expect(ok(Last4Schema, '8812')).toBe(true);
    expect(ok(Last4Schema, '881')).toBe(false);
    expect(ok(Last4Schema, 'abcd')).toBe(false);
    expect(ok(UnixSecondsSchema, 1761400000)).toBe(true);
    expect(ok(UnixSecondsSchema, -1)).toBe(false);
    expect(ok(UnixSecondsSchema, 1.5)).toBe(false);
    expect(ok(IsoDateTimeSchema, '2026-10-25T10:00:00.000Z')).toBe(true);
    expect(ok(IsoDateTimeSchema, '2026-10-25')).toBe(false);
    expect(ok(IsoDateTimeSchema, '2026-10-25T10:00:00+05:30')).toBe(false);
    expect(ok(Base64UrlSchema, 'abc-_09XYZ')).toBe(true);
    expect(ok(Base64UrlSchema, 'ab+/')).toBe(false);
    expect(ok(Base64UrlSchema, 'ab==')).toBe(false);
  });
});
