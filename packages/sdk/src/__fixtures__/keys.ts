// Test-only: throwaway Ed25519 keys (generated per run; none committed) and a grant signed the way Halyn signs one.
import { GRANT_TYP, type GrantClaims, paramsHash, signCompactJws } from '@halyn/shared';

export const NOW = Date.UTC(2026, 9, 26, 10, 0, 0);
export const PARAMS = { card_last4: '8812' };

export async function testKeys(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk = { kty: 'OKP', crv: 'Ed25519', x: pub.x ?? '', kid, alg: 'EdDSA', use: 'sig' } as const;
  return { signer: { key: pair.privateKey, kid }, jwks: { keys: [publicJwk] } };
}

export async function claims(overrides: Partial<GrantClaims> = {}): Promise<GrantClaims> {
  const iat = NOW / 1000;
  return {
    v: 'halyn-grant/0.1',
    jti: '01JBK2W4Z8Q3N5R7T9V1X3Z5B7',
    iss: 'halyn',
    aud: 'aero-core',
    tenant: 'ten_aero',
    sub: 'cus_saksham',
    action: 'card.freeze',
    params_hash: await paramsHash(PARAMS),
    request_id: 'req_01JBK2W4Z8Q3N5R7T9V1X3Z5B8',
    iat,
    exp: iat + 60,
    ...overrides,
  };
}

export async function grant(key: CryptoKey, kid: string, body: unknown, typ: string = GRANT_TYP) {
  return signCompactJws({ alg: 'EdDSA', kid, typ }, body, key);
}
