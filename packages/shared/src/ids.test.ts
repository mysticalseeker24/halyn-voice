import { describe, expect, it } from 'vitest';
import {
  Base64UrlSchema,
  E164Schema,
  Hex64Schema,
  IdSchema,
  IsoDateTimeSchema,
  Last4Schema,
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
