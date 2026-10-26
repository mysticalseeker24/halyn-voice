import { GRANT_TYP, paramsHash } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { claims, grant, NOW, PARAMS, testKeys } from './__fixtures__/keys';
import { verifyGrant } from './verify-grant';

// Test-engineer pass (Step 3): boundaries and binding cases for the check every bank write depends on (invariant 1).

const KID = 'halyn-2026-10';

async function signed(overrides: Parameters<typeof claims>[0] = {}, params: unknown = PARAMS) {
  const keys = await testKeys(KID);
  const body = await claims({ ...overrides, params_hash: await paramsHash(params) });
  return { jwks: keys.jwks, token: await grant(keys.signer.key, KID, body) };
}

const options = (jwks: unknown, now: number, params: unknown = PARAMS) => ({
  jwks,
  expectedAction: 'card.freeze' as const,
  params,
  now,
});

describe('time boundaries', () => {
  it('valid 1 ms before exp, expired at exp exactly (no leeway)', async () => {
    const { jwks, token } = await signed();
    const exp = NOW + 60_000;
    expect((await verifyGrant(token, options(jwks, exp - 1))).ok).toBe(true);
    expect(await verifyGrant(token, options(jwks, exp))).toEqual({ ok: false, code: 'E_GRANT_EXPIRED' });
  });

  it('iat up to 5 s ahead is accepted; 5.001 s ahead is not', async () => {
    const iat = NOW / 1000 + 5;
    const { jwks, token } = await signed({ iat, exp: iat + 60 });
    expect((await verifyGrant(token, options(jwks, NOW))).ok).toBe(true);
    expect(await verifyGrant(token, options(jwks, NOW - 1))).toEqual({ ok: false, code: 'E_GRANT_INVALID' });
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('now = %s fails closed', async (_, now) => {
    const { jwks, token } = await signed();
    expect(await verifyGrant(token, options(jwks, now))).toEqual({ ok: false, code: 'E_GRANT_INVALID' });
  });

  it('a negative now (clock far in the past) sees the grant as issued in the future', async () => {
    const { jwks, token } = await signed();
    expect(await verifyGrant(token, options(jwks, -1))).toEqual({ ok: false, code: 'E_GRANT_INVALID' });
  });
});

describe('params binding', () => {
  const nested = {
    amount_minor: 4_500_000,
    currency: 'INR',
    meta: { b: [1, { y: 2, x: 1 }], a: 'z' },
  };

  it('nested objects match in any key order; array order still matters', async () => {
    const { jwks, token } = await signed({}, nested);
    const reordered = { meta: { a: 'z', b: [1, { x: 1, y: 2 }] }, currency: 'INR', amount_minor: 4_500_000 };
    expect((await verifyGrant(token, options(jwks, NOW, reordered))).ok).toBe(true);
    const arraySwapped = { ...nested, meta: { ...nested.meta, b: [{ y: 2, x: 1 }, 1] } };
    expect(await verifyGrant(token, options(jwks, NOW, arraySwapped))).toEqual({
      ok: false,
      code: 'E_PARAMS_MISMATCH',
    });
  });

  it('an undefined field equals an absent one, and -0 equals 0 (canonical JSON, as on the wire)', async () => {
    const { jwks, token } = await signed({}, { card_last4: '8812', n: 0 });
    expect(
      (await verifyGrant(token, options(jwks, NOW, { card_last4: '8812', n: -0, x: undefined }))).ok,
    ).toBe(true);
  });

  it('amounts at MAX_SAFE_INTEGER bind exactly; one less is a mismatch', async () => {
    const big = { amount_minor: Number.MAX_SAFE_INTEGER, currency: 'INR' };
    const { jwks, token } = await signed({}, big);
    expect((await verifyGrant(token, options(jwks, NOW, big))).ok).toBe(true);
    expect(
      await verifyGrant(token, options(jwks, NOW, { ...big, amount_minor: Number.MAX_SAFE_INTEGER - 1 })),
    ).toEqual({ ok: false, code: 'E_PARAMS_MISMATCH' });
  });

  it('a string amount is not the number it spells', async () => {
    const { jwks, token } = await signed({}, { amount_minor: 60000, currency: 'INR' });
    expect(await verifyGrant(token, options(jwks, NOW, { amount_minor: '60000', currency: 'INR' }))).toEqual({
      ok: false,
      code: 'E_PARAMS_MISMATCH',
    });
  });
});

describe('who the grant is for (tenant and customer)', () => {
  it('params alone do not name the customer: a grant for one customer matches the same params for another', async () => {
    // card_last4 "8812" is not unique across customers, so the core must also check whom the grant is for.
    const { jwks, token } = await signed({ sub: 'cus_saksham' });
    expect((await verifyGrant(token, options(jwks, NOW))).ok).toBe(true);
  });

  it('expectedSub and expectedTenant reject a grant issued for another customer or tenant', async () => {
    const { jwks, token } = await signed({ sub: 'cus_saksham', tenant: 'ten_aero' });
    const base = options(jwks, NOW);
    expect(
      (await verifyGrant(token, { ...base, expectedSub: 'cus_saksham', expectedTenant: 'ten_aero' })).ok,
    ).toBe(true);
    expect(await verifyGrant(token, { ...base, expectedSub: 'cus_someone_else' })).toEqual({
      ok: false,
      code: 'E_GRANT_INVALID',
    });
    expect(await verifyGrant(token, { ...base, expectedTenant: 'ten_other' })).toEqual({
      ok: false,
      code: 'E_GRANT_INVALID',
    });
  });
});

describe('malformed tokens and headers', () => {
  it('a valid token with surrounding whitespace is not silently trimmed', async () => {
    const { jwks, token } = await signed();
    expect(await verifyGrant(` ${token} `, options(jwks, NOW))).toEqual({
      ok: false,
      code: 'E_GRANT_INVALID',
    });
  });

  it('a header whose kid is not a string → E_GRANT_INVALID', async () => {
    const keys = await testKeys(KID);
    const body = await claims();
    const token = await grant(keys.signer.key, 1 as unknown as string, body);
    expect(await verifyGrant(token, options(keys.jwks, NOW))).toEqual({ ok: false, code: 'E_GRANT_INVALID' });
  });

  it('a Pass-typed token signed by Halyn is never a grant', async () => {
    const keys = await testKeys(KID);
    const token = await grant(keys.signer.key, KID, await claims(), 'halyn-pass+jwt');
    expect(await verifyGrant(token, options(keys.jwks, NOW))).toEqual({ ok: false, code: 'E_GRANT_INVALID' });
    expect(GRANT_TYP).toBe('halyn-grant+jwt');
  });
});
