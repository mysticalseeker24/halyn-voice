import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { testKeys } from './__fixtures__/rng';
import { canonicalJson } from './canonical-json';
import {
  base64urlDecode,
  base64urlEncode,
  importVerifyKeys,
  signCompactJws,
  verifyCompactJws,
} from './crypto';

describe('crypto properties', () => {
  it('base64url round-trips any bytes and only canonical text decodes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 96 }), (bytes) => {
        const text = base64urlEncode(bytes);
        expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
        expect([...(base64urlDecode(text) ?? [])]).toEqual([...bytes]);
      }),
      { seed: 3001, numRuns: 300 },
    );
  });

  it('a JWS round-trips arbitrary JSON claims as their canonical form', async () => {
    const k = await testKeys('k1');
    const keys = await importVerifyKeys(k.jwks);
    const header = { alg: 'EdDSA', kid: 'k1', typ: 'halyn-pass+jwt' } as const;
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue({ maxDepth: 3 })),
        async (claims) => {
          const token = await signCompactJws(header, claims, k.signer.key);
          const result = await verifyCompactJws(token, keys, header.typ);
          expect(result.ok).toBe(true);
          if (result.ok) expect(canonicalJson(result.payload)).toBe(canonicalJson(claims));
        },
      ),
      { seed: 3002, numRuns: 60 },
    );
  });
});
