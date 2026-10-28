import { base64urlDecode, base64urlEncode, HalynError, type RequestOptionsJson } from '@halyn/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { softPasskey } from '../../test/fixtures/webauthn';
import { decodeCbor, decodeCborExact } from './cbor';
import { type Expected, verifyAuthentication, verifyRegistration } from './verify';

// Bounded fuzzing of the WebAuthn parsers (ADR-018): hostile bytes must end in a HalynError, never another exception,
// a hang or a giant allocation; and no tampering with a signed assertion may ever verify (invariant 3: only a real
// passkey is proof).

const ORIGIN = 'http://localhost:3000';
const RP = 'localhost';
const CHALLENGE = base64urlEncode(new Uint8Array(32).fill(9));
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

const onlyHalynError = (err: unknown) => expect(err).toBeInstanceOf(HalynError);

describe('CBOR decoder against hostile input', () => {
  it('a nesting bomb is a HalynError, not a stack overflow', () => {
    const bomb = new Uint8Array(50_000).fill(0x81); // [[[[ … 50,000 levels
    expect(() => decodeCbor(bomb)).toThrow(HalynError);
    const maps = new Uint8Array(50_000).fill(0xa1); // {{{{ …
    expect(() => decodeCborExact(maps)).toThrow(HalynError);
  });

  it('a huge claimed length with no bytes behind it fails fast without allocating', () => {
    const started = Date.now();
    for (const head of [
      [0x9b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], // array of 2^64-1
      [0x9a, 0xff, 0xff, 0xff, 0xff], // array of 2^32-1
      [0x5a, 0xff, 0xff, 0xff, 0xff], // byte string of 2^32-1
      [0x7a, 0xff, 0xff, 0xff, 0xff], // text string of 2^32-1
      [0xba, 0xff, 0xff, 0xff, 0xff], // map of 2^32-1
    ])
      expect(() => decodeCbor(Uint8Array.from(head))).toThrow(HalynError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('random byte strings and mutated valid items only ever throw HalynError', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 128 }), (bytes) => {
        try {
          decodeCborExact(bytes);
        } catch (err) {
          onlyHalynError(err);
        }
      }),
      { seed: 7, numRuns: 400 },
    );
  });
});

describe('verifyRegistration against a mutated attestationObject / clientDataJSON', () => {
  it('any single-byte change or truncation either verifies or throws HalynError (never anything else)', async () => {
    const key = await softPasskey();
    const good = await key.register(creation, ORIGIN);
    const attestation = base64urlDecode(good.response.attestationObject) as Uint8Array;
    const client = base64urlDecode(good.response.clientDataJSON) as Uint8Array;
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('attestationObject', 'clientDataJSON'),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        fc.boolean(),
        async (field, at, xor, truncate) => {
          const source = field === 'attestationObject' ? attestation : client;
          const bytes = truncate ? source.slice(0, at % source.length) : source.slice();
          if (!truncate) bytes[at % bytes.length] = (bytes[at % bytes.length] ?? 0) ^ xor;
          try {
            await verifyRegistration(
              { ...good, response: { ...good.response, [field]: base64urlEncode(bytes) } },
              expected,
            );
          } catch (err) {
            onlyHalynError(err);
          }
        },
      ),
      { seed: 11, numRuns: 150 },
    );
  });
});

describe('verifyAuthentication: no tampering with a signed assertion ever verifies (invariant 3)', () => {
  it.each([-7, -8] as const)(
    'alg %i: one flipped byte in authenticatorData, clientDataJSON or signature',
    async (alg) => {
      const key = await softPasskey(alg);
      const passkey = await verifyRegistration(await key.register(creation, ORIGIN), expected);
      const stored = { id: passkey.id, alg: passkey.alg, jwk: passkey.jwk, sign_count: 0 };
      const good = await key.authenticate(request, ORIGIN);
      // Sanity: the untouched assertion verifies.
      await expect(verifyAuthentication(good, expected, stored)).resolves.toBeDefined();
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('authenticatorData', 'clientDataJSON', 'signature'),
          fc.nat(),
          fc.integer({ min: 1, max: 255 }),
          async (field, at, xor) => {
            const bytes = (base64urlDecode(good.response[field]) as Uint8Array).slice();
            bytes[at % bytes.length] = (bytes[at % bytes.length] ?? 0) ^ xor;
            const attempt = verifyAuthentication(
              { ...good, response: { ...good.response, [field]: base64urlEncode(bytes) } },
              expected,
              stored,
            );
            await expect(attempt).rejects.toBeInstanceOf(HalynError);
          },
        ),
        { seed: 13, numRuns: 120 },
      );
    },
  );

  it('another passkey’s assertion never verifies against this stored key', async () => {
    const mine = await softPasskey();
    const theirs = await softPasskey();
    const passkey = await verifyRegistration(await mine.register(creation, ORIGIN), expected);
    const stored = { id: passkey.id, alg: passkey.alg, jwk: passkey.jwk, sign_count: 0 };
    await expect(
      verifyAuthentication(await theirs.authenticate(request, ORIGIN), expected, stored),
    ).rejects.toBeInstanceOf(HalynError);
  });
});
