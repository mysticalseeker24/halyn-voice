import {
  base64urlDecode,
  fixedClock,
  GRANT_TYP,
  GrantClaimsSchema,
  HalynError,
  importVerifyKeys,
  paramsHash,
  verifyCompactJws,
} from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { seededRng, testKeys } from '../../test/fixtures/crypto';
import { DEFAULT_GRANT_TTL_SECONDS, signGrant } from './index';

const NOW = Date.UTC(2026, 9, 26, 10, 0, 0);
const CLOCK = fixedClock(NOW);
const REQUEST = {
  tenant: 'ten_aero',
  sub: 'cus_saksham',
  action: 'card.freeze',
  params: { card_last4: '8812' },
  request_id: 'req_01JBK2W4Z8Q3N5R7T9V1X3Z5B7',
} as const;

describe('signGrant (invariant 1)', () => {
  it('signs claims bound to the exact params, with a ULID jti and a 60 s default life', async () => {
    const k = await testKeys('halyn-2026-10');
    const { token, claims } = await signGrant(REQUEST, k.signer, CLOCK, seededRng(1));
    expect(GrantClaimsSchema.parse(claims)).toEqual(claims);
    expect(claims).toMatchObject({
      v: 'halyn-grant/0.1',
      iss: 'halyn',
      aud: 'aero-core',
      tenant: 'ten_aero',
      sub: 'cus_saksham',
      action: 'card.freeze',
      request_id: REQUEST.request_id,
      iat: NOW / 1000,
      exp: NOW / 1000 + DEFAULT_GRANT_TTL_SECONDS,
    });
    expect(claims.params_hash).toBe(await paramsHash({ card_last4: '8812' }));
    const verified = await verifyCompactJws(token, await importVerifyKeys(k.jwks), GRANT_TYP);
    expect(verified).toEqual({
      ok: true,
      header: { alg: 'EdDSA', kid: 'halyn-2026-10', typ: GRANT_TYP },
      payload: claims,
    });
  });

  it('gives every grant its own jti (from the rng)', async () => {
    const k = await testKeys('k1');
    const a = await signGrant(REQUEST, k.signer, CLOCK, seededRng(1));
    const b = await signGrant(REQUEST, k.signer, CLOCK, seededRng(2));
    expect(a.claims.jti).not.toBe(b.claims.jti);
    expect(a.token).not.toBe(b.token);
  });

  it('hashes params canonically: key order does not change params_hash', async () => {
    const k = await testKeys('k1');
    const params = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
    const reordered = { fee_id: 'fee_late_oct', currency: 'INR', amount_minor: 60000 };
    const a = await signGrant({ ...REQUEST, action: 'fee.waive', params }, k.signer, CLOCK, seededRng(1));
    const b = await signGrant(
      { ...REQUEST, action: 'fee.waive', params: reordered },
      k.signer,
      CLOCK,
      seededRng(1),
    );
    expect(a.claims.params_hash).toBe(b.claims.params_hash);
  });

  it.each([0, 121, 1.5, -1, Number.NaN])('refuses a lifetime of %s s (exp ≤ 120 s)', async (ttl) => {
    const k = await testKeys('k1');
    await expect(signGrant(REQUEST, k.signer, CLOCK, seededRng(1), ttl)).rejects.toThrow(HalynError);
  });

  it('accepts the 120 s maximum', async () => {
    const k = await testKeys('k1');
    const { claims } = await signGrant(REQUEST, k.signer, CLOCK, seededRng(1), 120);
    expect(claims.exp - claims.iat).toBe(120);
  });

  it.each([
    ['params that fail the action schema', { ...REQUEST, params: { card_last4: '88' } }],
    ['an extra param key', { ...REQUEST, params: { card_last4: '8812', note: 'x' } }],
    ['an unknown action', { ...REQUEST, action: 'card.unfreeze' as never }],
    ['a bad request id', { ...REQUEST, request_id: 'nope' }],
  ])('fails closed on %s', async (_, request) => {
    const k = await testKeys('k1');
    await expect(signGrant(request, k.signer, CLOCK, seededRng(1))).rejects.toThrow(HalynError);
  });

  it('never puts the params themselves in the token, only their hash', async () => {
    const k = await testKeys('k1');
    const { token } = await signGrant(REQUEST, k.signer, CLOCK, seededRng(1));
    const payload = new TextDecoder().decode(base64urlDecode(token.split('.')[1] ?? '') ?? new Uint8Array());
    expect(payload).not.toContain('8812');
  });
});
