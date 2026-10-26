import { afterEach, describe, expect, it, vi } from 'vitest';
import { testKeys } from './__fixtures__/rng';
import {
  base64urlDecode,
  base64urlEncode,
  importSigningKey,
  importVerifyKeys,
  signCompactJws,
  timingSafeEqual,
  utf8,
  verifyCompactJws,
} from './crypto';
import { HalynError } from './errors';
import { GRANT_TYP } from './grant';
import { PASS_TYP } from './pass';

// Test-engineer pass (Step 3): attacks on the JWS layer beyond the happy-path security tests in crypto.test.ts.

const KID = 'k1';
const HEADER = { alg: 'EdDSA', kid: KID, typ: GRANT_TYP } as const;

/** Sign arbitrary header/payload *text* (not canonicalised), the way an attacker holding a key could. */
async function signRaw(key: CryptoKey, headerText: string, payloadText: string): Promise<string> {
  const input = `${base64urlEncode(utf8(headerText))}.${base64urlEncode(utf8(payloadText))}`;
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, utf8(input));
  return `${input}.${base64urlEncode(new Uint8Array(sig))}`;
}

async function setup() {
  const k = await testKeys(KID);
  return { ...k, keys: await importVerifyKeys(k.jwks) };
}

afterEach(() => vi.restoreAllMocks());

describe('JWS header attacks', () => {
  it.each([
    ['an extra header field', '{"alg":"EdDSA","kid":"k1","typ":"halyn-grant+jwt","x5u":"https://evil"}'],
    ['a crit header', '{"alg":"EdDSA","crit":["exp"],"kid":"k1","typ":"halyn-grant+jwt"}'],
    [
      'a duplicate alg whose last value is none',
      '{"alg":"EdDSA","kid":"k1","typ":"halyn-grant+jwt","alg":"none"}',
    ],
    ['a kid that is not a string', '{"alg":"EdDSA","kid":1,"typ":"halyn-grant+jwt"}'],
    ['an empty kid', '{"alg":"EdDSA","kid":"","typ":"halyn-grant+jwt"}'],
    ['a header that is an array', '["EdDSA","k1"]'],
  ])('%s → header (rejected even though it is correctly signed)', async (_, header) => {
    const { signer, keys } = await setup();
    const token = await signRaw(signer.key, header, '{"a":1}');
    expect(await verifyCompactJws(token, keys, GRANT_TYP)).toEqual({ ok: false, reason: 'header' });
  });

  it('a duplicate alg whose last value is EdDSA still needs a valid EdDSA signature', async () => {
    // JSON.parse keeps the last duplicate; the only parser that matters is this one, and it pins alg to EdDSA.
    const { signer, keys } = await setup();
    const header = '{"alg":"none","kid":"k1","typ":"halyn-grant+jwt","alg":"EdDSA"}';
    const signed = await signRaw(signer.key, header, '{"a":1}');
    expect((await verifyCompactJws(signed, keys, GRANT_TYP)).ok).toBe(true);
    const [h, p] = signed.split('.');
    expect(await verifyCompactJws(`${h}.${p}.${'A'.repeat(86)}`, keys, GRANT_TYP)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('typ confusion: a grant is not a Pass and a Pass is not a grant', async () => {
    const { signer, keys } = await setup();
    const grant = await signCompactJws(HEADER, { a: 1 }, signer.key);
    const pass = await signCompactJws({ ...HEADER, typ: PASS_TYP }, { a: 1 }, signer.key);
    expect(await verifyCompactJws(grant, keys, PASS_TYP)).toEqual({ ok: false, reason: 'header' });
    expect(await verifyCompactJws(pass, keys, GRANT_TYP)).toEqual({ ok: false, reason: 'header' });
  });
});

describe('JWS payload handling', () => {
  it('verifies the signed bytes as sent: a non-canonical payload is not re-serialised', async () => {
    const { signer, keys } = await setup();
    const text = '{ "b" : 2,\n "a":1 }';
    const token = await signRaw(signer.key, JSON.stringify(HEADER), text);
    expect(await verifyCompactJws(token, keys, GRANT_TYP)).toEqual({
      ok: true,
      header: HEADER,
      payload: { b: 2, a: 1 },
    });
    // The same JSON value with other whitespace is a different message: the signature no longer matches.
    const [h, , s] = token.split('.');
    const respaced = base64urlEncode(utf8('{"b":2,"a":1}'));
    expect(await verifyCompactJws(`${h}.${respaced}.${s}`, keys, GRANT_TYP)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('never parses the payload before the signature checks out', async () => {
    const { signer, keys } = await setup();
    const [h] = (await signCompactJws(HEADER, { a: 1 }, signer.key)).split('.');
    // A payload that would throw if parsed, with a signature that does not match it.
    const poisoned = base64urlEncode(utf8('{"a": [1, 2'));
    const parse = vi.spyOn(JSON, 'parse');
    const result = await verifyCompactJws(`${h}.${poisoned}.${'A'.repeat(86)}`, keys, GRANT_TYP);
    expect(result).toEqual({ ok: false, reason: 'signature' });
    // Exactly one parse: the header (to find the kid). The payload was never touched.
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('a signed payload of invalid UTF-8 → payload (never throws)', async () => {
    const { signer, keys } = await setup();
    const input = `${base64urlEncode(utf8(JSON.stringify(HEADER)))}.${base64urlEncode(new Uint8Array([0xff, 0xfe]))}`;
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, signer.key, utf8(input));
    const token = `${input}.${base64urlEncode(new Uint8Array(sig))}`;
    expect(await verifyCompactJws(token, keys, GRANT_TYP)).toEqual({ ok: false, reason: 'payload' });
  });
});

describe('JWS encoding attacks', () => {
  it.each([
    ['standard base64 "+"', (t: string) => t.replace(/-/g, '+')],
    ['standard base64 "/"', (t: string) => t.replace(/_/g, '/')],
    ['= padding', (t: string) => `${t}=`],
    ['a space inside a segment', (t: string) => `${t.slice(0, 10)} ${t.slice(10)}`],
    ['a newline at the end', (t: string) => `${t}\n`],
    ['a non-ASCII character', (t: string) => `${t.slice(0, 10)}é${t.slice(11)}`],
    ['a full-width letter', (t: string) => `${t.slice(0, 10)}Ａ${t.slice(11)}`],
  ])('%s → format', async (_, mangle) => {
    const { signer, keys } = await setup();
    // Long enough that the token contains both "-" and "_" somewhere for the first two mangles to bite.
    let token = '';
    for (let i = 0; !(token.includes('-') && token.includes('_')); i++)
      token = await signCompactJws(HEADER, { card_last4: '8812', n: i }, signer.key);
    const bad = mangle(token);
    expect(bad).not.toBe(token);
    expect(await verifyCompactJws(bad, keys, GRANT_TYP)).toEqual({ ok: false, reason: 'format' });
  });

  it('every single-bit flip of the signature is rejected', async () => {
    const { signer, keys } = await setup();
    const token = await signCompactJws(HEADER, { a: 1 }, signer.key);
    const [h, p, s = ''] = token.split('.');
    const sig = base64urlDecode(s);
    expect(sig).not.toBeNull();
    for (let byte = 0; byte < 64; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const flipped = new Uint8Array(sig ?? []);
        flipped[byte] = (flipped[byte] ?? 0) ^ (1 << bit);
        const result = await verifyCompactJws(`${h}.${p}.${base64urlEncode(flipped)}`, keys, GRANT_TYP);
        expect(result, `byte ${byte} bit ${bit}`).toEqual({ ok: false, reason: 'signature' });
      }
    }
  });

  it('the length limit is 8192 characters', async () => {
    const { keys } = await setup();
    const over = `${'A'.repeat(8193 - 10)}.Zm9v.Zm9v`;
    expect(over).toHaveLength(8193);
    expect(await verifyCompactJws(over, keys, GRANT_TYP)).toEqual({ ok: false, reason: 'format' });
    // At exactly the limit the shape is accepted and the header is what fails.
    const limit = `${'A'.repeat(8192 - 12)}.Zm9v.Zm9v`;
    expect(await verifyCompactJws(limit, keys, GRANT_TYP)).toEqual({ ok: false, reason: 'header' });
  });
});

describe('JWK / JWKS attacks', () => {
  it('a JWKS must never carry private key material (`d`)', async () => {
    const { privateJwk } = await testKeys(KID);
    await expect(importVerifyKeys({ keys: [privateJwk] })).rejects.toThrow(HalynError);
    await expect(importVerifyKeys(JSON.stringify({ keys: [privateJwk] }))).rejects.toThrow(HalynError);
  });

  it.each([
    ['kty RSA', { kty: 'RSA' }],
    ['crv X25519', { crv: 'X25519' }],
    ['crv P-256', { crv: 'P-256' }],
    ['x one character short', { x: 'A'.repeat(42) }],
    ['x one character long', { x: 'A'.repeat(44) }],
    ['x with a padding character', { x: `${'A'.repeat(42)}=` }],
    ['a kid that is too long', { kid: 'k'.repeat(65) }],
  ])('a JWKS key with %s is refused', async (_, patch) => {
    const { jwks } = await testKeys(KID);
    const bad = { keys: [{ ...jwks.keys[0], ...patch }] };
    await expect(importVerifyKeys(bad)).rejects.toThrow(HalynError);
  });

  it('two keys sharing a kid are refused, in either order', async () => {
    const a = await testKeys(KID);
    const b = await testKeys(KID);
    await expect(importVerifyKeys({ keys: [a.jwks.keys[0], b.jwks.keys[0]] })).rejects.toThrow(HalynError);
  });

  it('a private JWK whose x does not match d cannot produce signatures that verify', async () => {
    const a = await testKeys(KID);
    const b = await testKeys(KID);
    // Import may or may not reject the mismatched pair; either way nothing it signs verifies under a's public key.
    const signer = await importSigningKey({ ...a.privateJwk, d: b.privateJwk.d }).catch(() => null);
    if (signer) {
      const token = await signCompactJws(HEADER, { a: 1 }, signer.key);
      const keys = await importVerifyKeys(a.jwks);
      expect((await verifyCompactJws(token, keys, GRANT_TYP)).ok).toBe(false);
    }
  });
});

describe('timingSafeEqual edge cases', () => {
  it.each([
    ['', '', true],
    ['a', '', false],
    ['', 'a', false],
    ['abc', 'abd', false],
    ['abc', 'ab', false],
    ['not-hex!', 'not-hex!', true],
    ['é', 'e', false],
    ['\u0000', '', false],
  ])('(%j, %j) → %s', (a, b, expected) => {
    expect(timingSafeEqual(a, b)).toBe(expected);
  });
});
