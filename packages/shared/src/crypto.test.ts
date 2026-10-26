import { describe, expect, it } from 'vitest';
import { testKeys } from './__fixtures__/rng';
import {
  base64urlDecode,
  base64urlEncode,
  importSigningKey,
  importVerifyKeys,
  paramsHash,
  sha256Hex,
  signCompactJws,
  timingSafeEqual,
  utf8,
  verifyCompactJws,
} from './crypto';
import { HalynError } from './errors';

const HEADER = { alg: 'EdDSA', kid: 'k1', typ: 'halyn-grant+jwt' } as const;
const enc = (value: unknown) => base64urlEncode(utf8(JSON.stringify(value)));

async function signRaw(key: CryptoKey, header: string, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, utf8(`${header}.${payload}`));
  return `${header}.${payload}.${base64urlEncode(new Uint8Array(sig))}`;
}

describe('base64url', () => {
  it.each([
    [[], ''],
    [[0x66, 0x6f, 0x6f], 'Zm9v'],
    [[0xfb, 0xff], '-_8'],
    [[0x00], 'AA'],
  ])('encodes %j as %s and back', (bytes, text) => {
    expect(base64urlEncode(new Uint8Array(bytes))).toBe(text);
    expect([...(base64urlDecode(text) ?? [])]).toEqual(bytes);
  });

  it.each(['A', 'Zm9v=', 'Zm+v', 'Zm/v', '-_9', 'AB', 'Zm9 v'])(
    'rejects non-canonical or invalid %j',
    (text) => {
      expect(base64urlDecode(text)).toBeNull();
    },
  );
});

describe('sha256Hex and paramsHash', () => {
  it('matches the FIPS 180-2 vectors', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(utf8('abc'))).toBe(await sha256Hex('abc'));
  });

  it('hashes the canonical JSON of params, so key order does not matter', async () => {
    const a = await paramsHash({ card_last4: '8812', note: { b: 1, a: 2 } });
    const b = await paramsHash({ note: { a: 2, b: 1 }, card_last4: '8812' });
    expect(a).toBe(b);
    expect(a).toBe(await sha256Hex('{"card_last4":"8812","note":{"a":2,"b":1}}'));
    expect(await paramsHash({ card_last4: '8813' })).not.toBe(await paramsHash({ card_last4: '8812' }));
  });
});

describe('timingSafeEqual', () => {
  it('compares strings without early exit', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('Ed25519 keys', () => {
  it('imports a private JWK (object or JSON string) and a JWKS', async () => {
    const k = await testKeys('k1');
    const signer = await importSigningKey(JSON.stringify(k.privateJwk));
    expect(signer.kid).toBe('k1');
    const keys = await importVerifyKeys(k.jwks);
    expect([...keys.keys()]).toEqual(['k1']);
    expect((await importVerifyKeys(JSON.stringify(k.jwks))).has('k1')).toBe(true);
  });

  it.each([
    ['an RSA key', { kty: 'RSA', n: 'x', e: 'AQAB', d: 'x', kid: 'k1' }],
    ['a key without d', { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43), kid: 'k1' }],
    ['an X25519 key', { kty: 'OKP', crv: 'X25519', x: 'A'.repeat(43), d: 'A'.repeat(43), kid: 'k1' }],
    ['not JSON', '{nope'],
  ])('refuses %s as a signing key', async (_, jwk) => {
    await expect(importSigningKey(jwk)).rejects.toThrow(HalynError);
  });

  it('refuses an empty JWKS and duplicate kids', async () => {
    const k = await testKeys('k1');
    await expect(importVerifyKeys({ keys: [] })).rejects.toThrow(HalynError);
    await expect(importVerifyKeys({ keys: [k.jwks.keys[0], k.jwks.keys[0]] })).rejects.toThrow(HalynError);
    await expect(importVerifyKeys('nope')).rejects.toThrow(HalynError);
  });
});

describe('compact JWS (EdDSA)', () => {
  it('round-trips: header and canonical payload come back', async () => {
    const k = await testKeys('k1');
    const token = await signCompactJws(HEADER, { b: 2, a: 1 }, k.signer.key);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(new TextDecoder().decode(base64urlDecode(parts[1] ?? '') ?? new Uint8Array())).toBe(
      '{"a":1,"b":2}',
    );
    const result = await verifyCompactJws(token, await importVerifyKeys(k.jwks), HEADER.typ);
    expect(result).toEqual({ ok: true, header: HEADER, payload: { a: 1, b: 2 } });
  });

  it('signatures are deterministic for the same key and claims (Ed25519)', async () => {
    const k = await testKeys('k1');
    expect(await signCompactJws(HEADER, { a: 1 }, k.signer.key)).toBe(
      await signCompactJws(HEADER, { a: 1 }, k.signer.key),
    );
  });

  describe('security', () => {
    it('tampered payload → signature', async () => {
      const k = await testKeys('k1');
      const [h, , s] = (await signCompactJws(HEADER, { amount_minor: 100 }, k.signer.key)).split('.');
      const forged = `${h}.${enc({ amount_minor: 100000 })}.${s}`;
      const result = await verifyCompactJws(forged, await importVerifyKeys(k.jwks), HEADER.typ);
      expect(result).toEqual({ ok: false, reason: 'signature' });
    });

    it('tampered header (other typ, re-encoded) → signature', async () => {
      const k = await testKeys('k1');
      const [, p, s] = (await signCompactJws(HEADER, { a: 1 }, k.signer.key)).split('.');
      const forged = `${enc({ ...HEADER, kid: 'k1', typ: 'halyn-grant+jwt', extra: 1 })}.${p}.${s}`;
      expect(await verifyCompactJws(forged, await importVerifyKeys(k.jwks), HEADER.typ)).toEqual({
        ok: false,
        reason: 'header',
      });
      const swapped = `${enc({ alg: 'EdDSA', typ: 'halyn-grant+jwt', kid: 'k1' })}.${p}.${s}`;
      // Same header fields in another order: different bytes, so the signature no longer matches.
      expect((await verifyCompactJws(swapped, await importVerifyKeys(k.jwks), HEADER.typ)).ok).toBe(false);
    });

    it('tampered signature → signature', async () => {
      const k = await testKeys('k1');
      const token = await signCompactJws(HEADER, { a: 1 }, k.signer.key);
      const sig = base64urlDecode(token.split('.')[2] ?? '') ?? new Uint8Array();
      sig[0] = (sig[0] ?? 0) ^ 1;
      const forged = `${token.split('.').slice(0, 2).join('.')}.${base64urlEncode(sig)}`;
      expect(await verifyCompactJws(forged, await importVerifyKeys(k.jwks), HEADER.typ)).toEqual({
        ok: false,
        reason: 'signature',
      });
    });

    it('wrong key under the same kid → signature', async () => {
      const real = await testKeys('k1');
      const attacker = await testKeys('k1');
      const token = await signCompactJws(HEADER, { a: 1 }, attacker.signer.key);
      expect(await verifyCompactJws(token, await importVerifyKeys(real.jwks), HEADER.typ)).toEqual({
        ok: false,
        reason: 'signature',
      });
    });

    it('unknown kid → kid', async () => {
      const k = await testKeys('k1');
      const token = await signCompactJws({ ...HEADER, kid: 'k2' }, { a: 1 }, k.signer.key);
      expect(await verifyCompactJws(token, await importVerifyKeys(k.jwks), HEADER.typ)).toEqual({
        ok: false,
        reason: 'kid',
      });
    });

    it.each([
      ['alg none', { alg: 'none', kid: 'k1', typ: 'halyn-grant+jwt' }],
      ['HS256', { alg: 'HS256', kid: 'k1', typ: 'halyn-grant+jwt' }],
      ['a Pass typ where a grant is expected', { alg: 'EdDSA', kid: 'k1', typ: 'halyn-pass+jwt' }],
      ['no kid', { alg: 'EdDSA', typ: 'halyn-grant+jwt' }],
    ])('%s header → header', async (_, header) => {
      const k = await testKeys('k1');
      const token = await signRaw(k.signer.key, enc(header), enc({ a: 1 }));
      expect(await verifyCompactJws(token, await importVerifyKeys(k.jwks), HEADER.typ)).toEqual({
        ok: false,
        reason: 'header',
      });
    });

    it('a signed payload that is not JSON → payload', async () => {
      const k = await testKeys('k1');
      const token = await signRaw(k.signer.key, enc(HEADER), base64urlEncode(utf8('not json')));
      expect(await verifyCompactJws(token, await importVerifyKeys(k.jwks), HEADER.typ)).toEqual({
        ok: false,
        reason: 'payload',
      });
    });

    it.each([
      ['a non-string', 42],
      ['two segments', 'a.b'],
      ['four segments', 'a.b.c.d'],
      ['an empty segment', 'a..c'],
      ['a padded segment', 'Zm9v=.Zm9v.Zm9v'],
      ['a non-canonical segment', '-_9.Zm9v.Zm9v'],
      ['a header that is not JSON', `${base64urlEncode(utf8('nope'))}.Zm9v.Zm9v`],
      ['an oversized token', `${'A'.repeat(9000)}.Zm9v.Zm9v`],
    ])('%s → format or header', async (_, token) => {
      const k = await testKeys('k1');
      const result = await verifyCompactJws(token, await importVerifyKeys(k.jwks), HEADER.typ);
      expect(result.ok).toBe(false);
      expect(['format', 'header']).toContain(!result.ok && result.reason);
    });

    it('a key of another algorithm under the right kid → signature (never throws)', async () => {
      const k = await testKeys('k1');
      const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
      ]);
      const token = await signCompactJws(HEADER, { a: 1 }, k.signer.key);
      expect(await verifyCompactJws(token, new Map([['k1', hmac]]), HEADER.typ)).toEqual({
        ok: false,
        reason: 'signature',
      });
    });

    it('a signature of the wrong length → signature', async () => {
      const k = await testKeys('k1');
      const token = `${enc(HEADER)}.${enc({ a: 1 })}.${base64urlEncode(new Uint8Array(32))}`;
      expect(await verifyCompactJws(token, await importVerifyKeys(k.jwks), HEADER.typ)).toEqual({
        ok: false,
        reason: 'signature',
      });
    });
  });

  it('refuses to sign a header that is not EdDSA', async () => {
    const k = await testKeys('k1');
    await expect(
      signCompactJws({ alg: 'HS256', kid: 'k1', typ: 'x' } as never, { a: 1 }, k.signer.key),
    ).rejects.toThrow(HalynError);
  });
});
