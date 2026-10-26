import {
  type ActionId,
  GRANT_TYP,
  GRANT_VERSION,
  importSigningKey,
  newUlid,
  paramsHash,
  type Signer,
  signCompactJws,
} from '@halyn/shared';
import { TENANT, testEnv } from './env';

// Grants signed the way Halyn signs them (apps/api/src/grants/sign-grant.ts), with the run's throwaway key. Overrides
// are applied after the params hash, so a test can forge any claim and still sign it.

const systemRng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

export function ulid(nowMs = Date.now()): string {
  return newUlid({ nowMs: () => nowMs }, systemRng);
}

let signer: Promise<Signer> | undefined;
export function testSigner(): Promise<Signer> {
  signer ??= importSigningKey(testEnv().TEST_SIGNING_KEY);
  return signer;
}

/** A key Aero Core does not trust (optionally under the trusted kid). */
export async function strangerSigner(kid = 'stranger'): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return { key: pair.privateKey, kid };
}

export interface MintOptions {
  action: ActionId;
  params: unknown;
  sub: string;
  tenant?: string;
  /** Unix seconds; default now. */
  iat?: number;
  /** Seconds; default 60. */
  ttl?: number;
  jti?: string;
  overrides?: Record<string, unknown>;
  signer?: Signer;
  typ?: string;
}

export async function mintGrant(
  o: MintOptions,
): Promise<{ token: string; jti: string; claims: Record<string, unknown> }> {
  const iat = o.iat ?? Math.floor(Date.now() / 1000);
  const jti = o.jti ?? ulid(iat * 1000);
  const claims: Record<string, unknown> = {
    v: GRANT_VERSION,
    jti,
    iss: 'halyn',
    aud: 'aero-core',
    tenant: o.tenant ?? TENANT,
    sub: o.sub,
    action: o.action,
    params_hash: await paramsHash(o.params),
    request_id: `req_${ulid(iat * 1000)}`,
    iat,
    exp: iat + (o.ttl ?? 60),
    ...o.overrides,
  };
  const key = o.signer ?? (await testSigner());
  const token = await signCompactJws(
    { alg: 'EdDSA', kid: key.kid, typ: o.typ ?? GRANT_TYP },
    claims,
    key.key,
  );
  return { token, jti, claims };
}
