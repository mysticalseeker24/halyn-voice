import { base64urlEncode, HalynError, importVerifyKeys, PASS_TYP, signCompactJws, utf8 } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { testKeys } from '../../test/fixtures/crypto';
import { issuedPass, NOW } from '../../test/fixtures/pass';
import { signPass, verifyPassToken } from './index';

describe('signPass / verifyPassToken', () => {
  it('round-trips the claims', async () => {
    const { keys, claims, token } = await issuedPass();
    expect(await verifyPassToken(token, await importVerifyKeys(keys.jwks), NOW)).toEqual({
      ok: true,
      claims,
    });
  });

  it('refuses to sign claims that are not a valid Pass', async () => {
    const { keys, claims } = await issuedPass();
    await expect(signPass({ ...claims, scopes: [{ action: 'wire.new' }] }, keys.signer)).rejects.toThrow(
      HalynError,
    );
  });

  describe('security', () => {
    it('tampered payload (an added scope) → invalid', async () => {
      const { keys, claims, token } = await issuedPass();
      const [h, , s] = token.split('.');
      const forged = { ...claims, scopes: [...claims.scopes, { action: 'balance.view' }] };
      const tampered = `${h}.${base64urlEncode(utf8(JSON.stringify(forged)))}.${s}`;
      expect(await verifyPassToken(tampered, await importVerifyKeys(keys.jwks), NOW)).toEqual({ ok: false });
    });

    it('signed with another key under the same kid → invalid', async () => {
      const { claims } = await issuedPass();
      const real = await testKeys('halyn-2026-10');
      const attacker = await testKeys('halyn-2026-10');
      const token = await signPass(claims, attacker.signer);
      expect(await verifyPassToken(token, await importVerifyKeys(real.jwks), NOW)).toEqual({ ok: false });
    });

    it('expired → invalid (at exp exactly)', async () => {
      const { keys, claims, token } = await issuedPass();
      const verifyKeys = await importVerifyKeys(keys.jwks);
      expect((await verifyPassToken(token, verifyKeys, claims.exp * 1000 - 1)).ok).toBe(true);
      expect(await verifyPassToken(token, verifyKeys, claims.exp * 1000)).toEqual({ ok: false });
    });

    it('issued in the future (beyond 5 s of skew) → invalid', async () => {
      const { keys, token } = await issuedPass();
      const verifyKeys = await importVerifyKeys(keys.jwks);
      expect((await verifyPassToken(token, verifyKeys, NOW - 5000)).ok).toBe(true);
      expect(await verifyPassToken(token, verifyKeys, NOW - 5001)).toEqual({ ok: false });
    });

    it('a correctly signed token whose payload is not a Pass → invalid', async () => {
      const { keys } = await issuedPass();
      const token = await signCompactJws(
        { alg: 'EdDSA', kid: keys.signer.kid, typ: PASS_TYP },
        { v: 'halyn-grant/0.1', action: 'card.freeze' },
        keys.signer.key,
      );
      expect(await verifyPassToken(token, await importVerifyKeys(keys.jwks), NOW)).toEqual({ ok: false });
    });

    it.each([
      ['garbage', 'a.b.c'],
      ['empty', ''],
      ['not a string', 42],
    ])('%s → invalid', async (_, token) => {
      const { keys } = await issuedPass();
      expect(await verifyPassToken(token, await importVerifyKeys(keys.jwks), NOW)).toEqual({ ok: false });
    });
  });
});
