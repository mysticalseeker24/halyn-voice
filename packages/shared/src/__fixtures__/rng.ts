// Test-only helpers: a deterministic rng and throwaway Ed25519 keys. Never used outside tests.
import type { Rng } from '../clock';

/** mulberry32: deterministic bytes for tests. Not cryptographic. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    bytes(n: number): Uint8Array {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 4) {
        const v = next();
        for (let j = 0; j < 4 && i + j < n; j++) out[i + j] = (v >>> (8 * j)) & 0xff;
      }
      return out;
    },
  };
}

/** A fresh Ed25519 key pair with its public JWKS (keys are generated per test run; none are committed). */
export async function testKeys(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = { kty: 'OKP', crv: 'Ed25519', x: pub.x, kid, alg: 'EdDSA', use: 'sig' } as const;
  return {
    signer: { key: pair.privateKey, kid },
    privateJwk: { ...publicJwk, d: priv.d },
    jwks: { keys: [publicJwk] },
  };
}
