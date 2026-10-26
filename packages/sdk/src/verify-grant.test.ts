import { base64urlEncode, utf8 } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { claims, grant, NOW, PARAMS, testKeys } from './__fixtures__/keys';
import { verifyGrant } from './verify-grant';

const OPTS = { expectedAction: 'card.freeze', params: PARAMS, now: NOW + 1000 } as const;

async function setup() {
  const k = await testKeys('halyn-2026-10');
  const c = await claims();
  return { k, c, token: await grant(k.signer.key, k.signer.kid, c) };
}

describe('verifyGrant', () => {
  it('accepts a valid grant and returns its jti and claims', async () => {
    const { k, c, token } = await setup();
    expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks })).toEqual({ ok: true, jti: c.jti, claims: c });
  });

  it('accepts the JWKS as the JSON string from an env var, and params in any key order', async () => {
    const { k, token } = await setup();
    const result = await verifyGrant(token, {
      ...OPTS,
      jwks: JSON.stringify(k.jwks),
      params: { card_last4: '8812' },
    });
    expect(result.ok).toBe(true);
    const multi = await claims({ action: 'fee.waive' });
    const p = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
    const t = await grant(k.signer.key, k.signer.kid, {
      ...multi,
      params_hash: (await claims()).params_hash,
    });
    expect((await verifyGrant(t, { ...OPTS, jwks: k.jwks, expectedAction: 'fee.waive', params: p })).ok).toBe(
      false,
    );
  });

  it.each([undefined, null, '', '   '])('missing grant (%j) → E_GRANT_MISSING', async (token) => {
    const { k } = await setup();
    expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks })).toEqual({
      ok: false,
      code: 'E_GRANT_MISSING',
    });
  });

  describe('security', () => {
    it('tampered payload (amount changed, signature kept) → E_GRANT_INVALID', async () => {
      const { k, c, token } = await setup();
      const [h, , s] = token.split('.');
      const forged = `${h}.${base64urlEncode(utf8(JSON.stringify({ ...c, action: 'fee.waive' })))}.${s}`;
      expect(await verifyGrant(forged, { ...OPTS, jwks: k.jwks })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });

    it('signed by another key under the same kid → E_GRANT_INVALID', async () => {
      const { k, c } = await setup();
      const attacker = await testKeys('halyn-2026-10');
      const forged = await grant(attacker.signer.key, 'halyn-2026-10', c);
      expect(await verifyGrant(forged, { ...OPTS, jwks: k.jwks })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });

    it('unknown kid, a Pass token, or a bad JWKS → E_GRANT_INVALID', async () => {
      const { k, c } = await setup();
      const otherKid = await grant(k.signer.key, 'halyn-2026-11', c);
      expect(await verifyGrant(otherKid, { ...OPTS, jwks: k.jwks })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
      const passToken = await grant(k.signer.key, k.signer.kid, c, 'halyn-pass+jwt');
      expect(await verifyGrant(passToken, { ...OPTS, jwks: k.jwks })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
      const { token } = await setup();
      expect(await verifyGrant(token, { ...OPTS, jwks: { keys: [] } })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
      expect(await verifyGrant(token, { ...OPTS, jwks: '{nope' })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });

    it.each([
      ['alg none', { alg: 'none', kid: 'halyn-2026-10', typ: 'halyn-grant+jwt' }],
      ['HS256', { alg: 'HS256', kid: 'halyn-2026-10', typ: 'halyn-grant+jwt' }],
    ])('%s header → E_GRANT_INVALID', async (_, header) => {
      const { k, c } = await setup();
      const enc = (v: unknown) => base64urlEncode(utf8(JSON.stringify(v)));
      const forged = `${enc(header)}.${enc(c)}.${base64urlEncode(new Uint8Array(64))}`;
      expect(await verifyGrant(forged, { ...OPTS, jwks: k.jwks })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });

    it('expired (now ≥ exp, no leeway) → E_GRANT_EXPIRED', async () => {
      const { k, c, token } = await setup();
      expect((await verifyGrant(token, { ...OPTS, jwks: k.jwks, now: c.exp * 1000 - 1 })).ok).toBe(true);
      expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks, now: c.exp * 1000 })).toEqual({
        ok: false,
        code: 'E_GRANT_EXPIRED',
      });
    });

    it('issued more than 5 s in the future → E_GRANT_INVALID', async () => {
      const { k, c, token } = await setup();
      expect((await verifyGrant(token, { ...OPTS, jwks: k.jwks, now: c.iat * 1000 - 5000 })).ok).toBe(true);
      expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks, now: c.iat * 1000 - 5001 })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });

    it('params mismatch (different amount, extra key, missing key) → E_PARAMS_MISMATCH', async () => {
      const { k, token } = await setup();
      for (const params of [{ card_last4: '8813' }, { card_last4: '8812', note: 'x' }, {}]) {
        expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks, params })).toEqual({
          ok: false,
          code: 'E_PARAMS_MISMATCH',
        });
      }
    });

    it('params that are not JSON data → E_PARAMS_MISMATCH (never throws)', async () => {
      const { k, token } = await setup();
      expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks, params: { n: Number.NaN } })).toEqual({
        ok: false,
        code: 'E_PARAMS_MISMATCH',
      });
    });

    it('a grant for another action → E_GRANT_INVALID', async () => {
      const { k, token } = await setup();
      expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks, expectedAction: 'transfer.saved' })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });

    it.each([
      ['another audience', { aud: 'halyn-api' }],
      ['another issuer', { iss: 'mallory' }],
      ['a lifetime over 120 s', { exp: NOW / 1000 + 121 }],
      ['a malformed jti', { jti: 'not-a-ulid' }],
    ])('signed claims with %s → E_GRANT_INVALID', async (_, patch) => {
      const { k } = await setup();
      const token = await grant(k.signer.key, k.signer.kid, { ...(await claims()), ...patch });
      expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });

    it('a non-finite now fails closed', async () => {
      const { k, token } = await setup();
      expect(await verifyGrant(token, { ...OPTS, jwks: k.jwks, now: Number.NaN })).toEqual({
        ok: false,
        code: 'E_GRANT_INVALID',
      });
    });
  });

  it('reuses imported keys for the same JWKS object', async () => {
    const { k, token } = await setup();
    const spy = { calls: 0 };
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = ((...args: Parameters<typeof original>) => {
      spy.calls += 1;
      return original(...args);
    }) as typeof crypto.subtle.importKey;
    try {
      await verifyGrant(token, { ...OPTS, jwks: k.jwks });
      await verifyGrant(token, { ...OPTS, jwks: k.jwks });
      expect(spy.calls).toBe(1);
    } finally {
      crypto.subtle.importKey = original;
    }
  });
});
