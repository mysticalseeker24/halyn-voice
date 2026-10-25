import { describe, expect, it } from 'vitest';
import {
  GRANT_MAX_TTL_SECONDS,
  GRANT_VERSION,
  type GrantClaims,
  GrantClaimsSchema,
  GrantHeaderSchema,
} from './grant';

const grant = (): GrantClaims => ({
  v: 'halyn-grant/0.1',
  jti: '01J9Z8X7W6V5T4S3R2Q1P0N9M8',
  iss: 'halyn',
  aud: 'aero-core',
  tenant: 'ten_aero',
  sub: 'cus_saksham',
  action: 'card.freeze',
  params_hash: 'ab'.repeat(32),
  request_id: 'req_01J9Z8X7W6V5T4S3R2Q1P0N9M8',
  iat: 1761400000,
  exp: 1761400060,
});

describe('GrantClaimsSchema', () => {
  it('accepts a one-time grant bound to the params hash', () => {
    expect(GRANT_VERSION).toBe('halyn-grant/0.1');
    expect(GrantClaimsSchema.parse(grant())).toEqual(grant());
  });

  it(`allows a lifetime of exactly ${GRANT_MAX_TTL_SECONDS} s (invariant 1)`, () => {
    expect(GRANT_MAX_TTL_SECONDS).toBe(120);
    expect(GrantClaimsSchema.safeParse({ ...grant(), exp: grant().iat + 120 }).success).toBe(true);
  });

  it.each<[string, Partial<Record<keyof GrantClaims | 'extra', unknown>>]>([
    ['a lifetime over 120 s', { exp: 1761400121 }],
    ['exp equal to iat', { exp: 1761400000 }],
    ['exp before iat', { exp: 1761399999 }],
    ['an upper-case params hash', { params_hash: 'AB'.repeat(32) }],
    ['a short params hash', { params_hash: 'ab'.repeat(31) }],
    ['a jti that is not a ULID', { jti: 'grant-1' }],
    ['another audience', { aud: 'halyn' }],
    ['another issuer', { iss: 'aero-core' }],
    ['an unknown action', { action: 'card.melt' }],
    ['an unknown claim', { extra: 1 }],
  ])('rejects %s', (_, change) => {
    expect(GrantClaimsSchema.safeParse({ ...grant(), ...change }).success).toBe(false);
  });
});

describe('GrantHeaderSchema', () => {
  it('pins EdDSA and the grant media type', () => {
    expect(
      GrantHeaderSchema.safeParse({ alg: 'EdDSA', kid: 'halyn-2026-10', typ: 'halyn-grant+jwt' }).success,
    ).toBe(true);
    expect(
      GrantHeaderSchema.safeParse({ alg: 'none', kid: 'halyn-2026-10', typ: 'halyn-grant+jwt' }).success,
    ).toBe(false);
    expect(GrantHeaderSchema.safeParse({ alg: 'EdDSA', kid: '', typ: 'halyn-grant+jwt' }).success).toBe(
      false,
    );
  });
});
