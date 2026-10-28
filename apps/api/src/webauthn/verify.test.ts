import { base64urlDecode, base64urlEncode, HalynError, type RequestOptionsJson, utf8 } from '@halyn/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeCbor, rawToDer, softPasskey } from '../../test/fixtures/webauthn';
import { decodeCbor, decodeCborExact } from './cbor';
import { coseToJwk, derToRaw, type Expected, verifyAuthentication, verifyRegistration } from './verify';

const ORIGIN = 'http://localhost:3000';
const RP = 'localhost';
const CHALLENGE = base64urlEncode(new Uint8Array(32).fill(7));
const expected: Expected = { challenge: CHALLENGE, origins: [ORIGIN], rpId: RP };

const creation = {
  rp: { id: RP, name: 'Aero Bank' },
  user: { id: 'Y3Vz', name: 'cus_saksham', displayName: 'Saksham Mishra' },
  challenge: CHALLENGE,
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 as const }],
  timeout: 60000,
  attestation: 'none' as const,
  authenticatorSelection: { residentKey: 'preferred' as const, userVerification: 'required' as const },
  excludeCredentials: [],
};
const request: RequestOptionsJson = {
  challenge: CHALLENGE,
  rpId: RP,
  timeout: 60000,
  userVerification: 'required',
  allowCredentials: [],
};

async function registered(alg: -7 | -8 = -7) {
  const key = await softPasskey(alg);
  const passkey = await verifyRegistration(await key.register(creation, ORIGIN), expected);
  return {
    key,
    stored: { id: passkey.id, alg: passkey.alg, jwk: passkey.jwk, sign_count: passkey.sign_count },
  };
}

describe('passkey registration (attestation "none")', () => {
  it.each([-7, -8] as const)('alg %i: verifies and returns the key as a JWK', async (alg) => {
    const key = await softPasskey(alg);
    const passkey = await verifyRegistration(await key.register(creation, ORIGIN), expected);
    expect(passkey.id).toBe(key.id);
    expect(passkey.alg).toBe(alg);
    expect(passkey.jwk.kty).toBe(alg === -7 ? 'EC' : 'OKP');
    expect(passkey.sign_count).toBe(0);
  });

  it('refuses another challenge, origin, RP id, ceremony, no user verification, or a swapped id', async () => {
    const key = await softPasskey();
    const good = await key.register(creation, ORIGIN);
    const refuse = (p: Promise<unknown>) => expect(p).rejects.toThrow(HalynError);
    await refuse(verifyRegistration(good, { ...expected, challenge: base64urlEncode(new Uint8Array(32)) }));
    await refuse(verifyRegistration(good, { ...expected, origins: ['https://evil.test'] }));
    await refuse(verifyRegistration(good, { ...expected, rpId: 'evil.test' }));
    await refuse(verifyRegistration(await key.register(creation, ORIGIN, 0x41), expected)); // UP + AT, no UV
    await refuse(verifyRegistration({ ...good, id: 'AAAA', rawId: 'AAAA' }, expected));
    await refuse(verifyRegistration({ ...good, rawId: 'AAAA' }, expected));
    await refuse(
      verifyRegistration(
        {
          ...good,
          response: { ...good.response, attestationObject: base64urlEncode(encodeCbor({ fmt: 'none' })) },
        },
        expected,
      ),
    );
    await refuse(
      verifyRegistration(
        { ...good, response: { ...good.response, clientDataJSON: base64urlEncode(utf8('{')) } },
        expected,
      ),
    );
  });
});

describe('passkey assertion (the Confirm passkey leg)', () => {
  it.each([-7, -8] as const)('alg %i: verifies the signature and returns the new counter', async (alg) => {
    const { key, stored } = await registered(alg);
    const result = await verifyAuthentication(await key.authenticate(request, ORIGIN), expected, stored);
    expect(result.sign_count).toBe(1);
  });

  it('refuses a wrong challenge, origin, RP id, missing UV, another ceremony, a bad signature or a counter going back', async () => {
    const { key, stored } = await registered();
    const refuse = (p: Promise<unknown>, why: RegExp) => expect(p).rejects.toThrow(why);
    await refuse(
      verifyAuthentication(
        await key.authenticate({ ...request, challenge: 'AAAAAAAAAAAAAAAAAAAAAA' }, ORIGIN),
        expected,
        stored,
      ),
      /challenge/,
    );
    await refuse(
      verifyAuthentication(await key.authenticate(request, 'https://evil.test'), expected, stored),
      /origin/,
    );
    await refuse(
      verifyAuthentication(await key.authenticate(request, ORIGIN, { rpId: 'evil.test' }), expected, stored),
      /RP id/,
    );
    await refuse(
      verifyAuthentication(await key.authenticate(request, ORIGIN, { flags: 0x01 }), expected, stored),
      /verification/,
    );
    await refuse(
      verifyAuthentication(await key.authenticate(request, ORIGIN, { flags: 0x04 }), expected, stored),
      /presence/,
    );
    await refuse(
      verifyAuthentication(
        await key.authenticate(request, ORIGIN, { type: 'webauthn.create' }),
        expected,
        stored,
      ),
      /type/,
    );
    const good = await key.authenticate(request, ORIGIN);
    const sig = base64urlDecode(good.response.signature) as Uint8Array;
    sig[sig.length - 1] = (sig[sig.length - 1] ?? 0) ^ 1;
    await refuse(
      verifyAuthentication(
        { ...good, response: { ...good.response, signature: base64urlEncode(sig) } },
        expected,
        stored,
      ),
      /signature/,
    );
    await refuse(
      verifyAuthentication(await key.authenticate(request, ORIGIN, { counter: 5 }), expected, {
        ...stored,
        sign_count: 9,
      }),
      /sign count/,
    );
    const other = await registered();
    await refuse(
      verifyAuthentication(await key.authenticate(request, ORIGIN), expected, other.stored),
      /credential id/,
    );
    await refuse(
      verifyAuthentication(
        { ...good, response: { ...good.response, authenticatorData: 'AAAA' } },
        expected,
        stored,
      ),
      /short/,
    );
  });

  it('accepts a counter that stays 0 (many passkeys never count)', async () => {
    const { key, stored } = await registered(-8);
    expect(
      (await verifyAuthentication(await key.authenticate(request, ORIGIN, { counter: 0 }), expected, stored))
        .sign_count,
    ).toBe(0);
  });

  it('CPU: one assertion check (ES256) costs well under the 10 ms Workers budget', async () => {
    const { key, stored } = await registered();
    const assertions = await Promise.all(
      Array.from({ length: 30 }, (_, i) => key.authenticate(request, ORIGIN, { counter: i + 1 })),
    );
    const started = performance.now();
    for (const [i, a] of assertions.entries())
      await verifyAuthentication(a, expected, { ...stored, sign_count: i });
    const perCall = (performance.now() - started) / assertions.length;
    console.info(
      `passkey assertion verify: ${perCall.toFixed(3)} ms per call (30 calls, wall time in workerd)`,
    );
    expect(perCall).toBeLessThan(10);
  });
});

describe('CBOR and DER helpers', () => {
  it('decode what the encoder writes, and report where an item ends', () => {
    const bytes = encodeCbor(
      new Map<number | string, number | string | Uint8Array>([
        [1, 2],
        [-1, 'x'],
        ['k', Uint8Array.of(1, 2)],
      ]),
    );
    const value = decodeCborExact(bytes) as Map<unknown, unknown>;
    expect(value.get(1)).toBe(2);
    expect(value.get(-1)).toBe('x');
    expect(decodeCbor(Uint8Array.of(0x01, 0x02)).end).toBe(1);
  });

  it.each([
    ['truncated', Uint8Array.of(0x59, 0x01)],
    ['trailing bytes', Uint8Array.of(0x01, 0x02)],
    ['indefinite length', Uint8Array.of(0x5f)],
    ['tag', Uint8Array.of(0xc1, 0x01)],
    ['float', Uint8Array.of(0xf9, 0x00, 0x00)],
    ['duplicate key', Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02)],
    ['array key', Uint8Array.of(0xa1, 0x80, 0x01)],
    ['bad UTF-8', Uint8Array.of(0x61, 0xff)],
  ])('refuse %s', (_, bytes) => {
    expect(() => decodeCborExact(bytes)).toThrow(HalynError);
  });

  it('reads simple values and long lengths', () => {
    expect(decodeCborExact(Uint8Array.of(0xf4))).toBe(false);
    expect(decodeCborExact(Uint8Array.of(0xf5))).toBe(true);
    expect(decodeCborExact(Uint8Array.of(0xf6))).toBeNull();
    expect(decodeCborExact(Uint8Array.of(0xf7))).toBeUndefined();
    expect(decodeCborExact(Uint8Array.of(0x1a, 0x00, 0x01, 0x00, 0x00))).toBe(65536);
    expect(decodeCborExact(Uint8Array.of(0x1b, 0, 0, 0, 1, 0, 0, 0, 0))).toBe(2 ** 32);
    expect(() => decodeCborExact(Uint8Array.of(0x1b, 0xff, 0, 0, 0, 0, 0, 0, 0))).toThrow(/too large/);
    const deep = Uint8Array.from([...Array(10).fill(0x81), 0x01]);
    expect(() => decodeCborExact(deep)).toThrow(/deeply/);
  });

  it('never throws anything but HalynError on random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        try {
          decodeCbor(bytes);
        } catch (err) {
          expect(err).toBeInstanceOf(HalynError);
        }
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('DER ↔ raw ECDSA signatures round-trip, and malformed DER is refused', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 64, maxLength: 64 }), (raw) => {
        expect([...derToRaw(rawToDer(raw))]).toEqual([...raw]);
      }),
      { seed: 9, numRuns: 200 },
    );
    expect(() => derToRaw(Uint8Array.of(0x31, 0x00))).toThrow(HalynError);
    expect(() => derToRaw(Uint8Array.of(0x30, 0x03, 0x03, 0x01, 0x00))).toThrow(HalynError);
  });

  it('COSE keys: only the three offered algorithms', () => {
    expect(() =>
      coseToJwk(
        new Map([
          [1, 2],
          [3, -35],
        ]),
      ),
    ).toThrow(/unsupported/);
    expect(() => coseToJwk('x')).toThrow(/public key/);
    expect(
      coseToJwk(
        new Map<number, number | Uint8Array>([
          [1, 3],
          [3, -257],
          [-1, Uint8Array.of(1)],
          [-2, Uint8Array.of(1, 0, 1)],
        ]),
      ).jwk.kty,
    ).toBe('RSA');
    expect(() =>
      coseToJwk(
        new Map<number, number>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, 5],
        ]),
      ),
    ).toThrow(/field/);
  });
});
