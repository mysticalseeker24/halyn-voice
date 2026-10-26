import {
  type ActionId,
  GRANT_TYP,
  type GrantClaims,
  GrantClaimsSchema,
  importVerifyKeys,
  paramsHash,
  timingSafeEqual,
  verifyCompactJws,
} from '@halyn/shared';

// What a bank's core runs before any write (invariant 1). The jti is returned, not checked: single use is the core's
// job (insert the jti into its own store in the same transaction as the write, e.g. D1 `used_grants`).

export type VerifyGrantCode = 'E_GRANT_MISSING' | 'E_GRANT_INVALID' | 'E_GRANT_EXPIRED' | 'E_PARAMS_MISMATCH';

export type VerifyGrantResult =
  { ok: true; jti: string; claims: GrantClaims } | { ok: false; code: VerifyGrantCode };

export interface VerifyGrantOptions {
  /** Halyn's public JWKS: the object, or the JSON string from an env var. */
  jwks: unknown;
  /**
   * The action this route performs, or the list when one route serves several (e.g. `POST /core/transfers`); a grant
   * for any other action is invalid. The verified action is `claims.action`.
   */
  expectedAction: ActionId | readonly ActionId[];
  /** The exact params about to be executed; their canonical SHA-256 must equal the grant's params_hash. */
  params: unknown;
  /** Current time in epoch milliseconds (`Date.now()`). */
  now: number;
  /**
   * The customer whose account this write touches. Params alone do not name the customer (a card's last 4 digits are
   * not unique), so pass it whenever the route knows it — or act only on `claims.sub`'s accounts.
   */
  expectedSub?: string;
  /** The bank's tenant id in Halyn, when one core serves several. */
  expectedTenant?: string;
}

/** Accepted clock skew for `iat`. `exp` has none. */
const IAT_SKEW_MS = 5000;

const keyCache = new WeakMap<object, Promise<ReadonlyMap<string, CryptoKey>>>();

function verifyKeys(jwks: unknown): Promise<ReadonlyMap<string, CryptoKey>> {
  if (typeof jwks !== 'object' || jwks === null) return importVerifyKeys(jwks);
  let keys = keyCache.get(jwks);
  if (!keys) {
    keys = importVerifyKeys(jwks);
    keyCache.set(jwks, keys);
    void keys.catch(() => keyCache.delete(jwks));
  }
  return keys;
}

const fail = (code: VerifyGrantCode): VerifyGrantResult => ({ ok: false, code });

/**
 * Order: present → signature (alg EdDSA, typ halyn-grant+jwt, known kid) → claims schema (iss, aud, version,
 * 0 < exp − iat ≤ 120 s) → action → customer / tenant (when expected) → iat not in the future → not expired →
 * params hash. Never throws.
 */
export async function verifyGrant(
  token: string | null | undefined,
  options: VerifyGrantOptions,
): Promise<VerifyGrantResult> {
  if (typeof token !== 'string' || token.trim() === '') return fail('E_GRANT_MISSING');
  if (!Number.isFinite(options.now)) return fail('E_GRANT_INVALID');
  let keys: ReadonlyMap<string, CryptoKey>;
  try {
    keys = await verifyKeys(options.jwks);
  } catch {
    return fail('E_GRANT_INVALID');
  }
  const jws = await verifyCompactJws(token, keys, GRANT_TYP);
  if (!jws.ok) return fail('E_GRANT_INVALID');
  const parsed = GrantClaimsSchema.safeParse(jws.payload);
  if (!parsed.success) return fail('E_GRANT_INVALID');
  const claims = parsed.data;
  const expected: readonly ActionId[] =
    typeof options.expectedAction === 'string' ? [options.expectedAction] : options.expectedAction;
  if (!expected.includes(claims.action)) return fail('E_GRANT_INVALID');
  if (options.expectedSub !== undefined && claims.sub !== options.expectedSub) return fail('E_GRANT_INVALID');
  if (options.expectedTenant !== undefined && claims.tenant !== options.expectedTenant)
    return fail('E_GRANT_INVALID');
  if (claims.iat * 1000 > options.now + IAT_SKEW_MS) return fail('E_GRANT_INVALID');
  if (claims.exp * 1000 <= options.now) return fail('E_GRANT_EXPIRED');
  let hash: string;
  try {
    hash = await paramsHash(options.params);
  } catch {
    return fail('E_PARAMS_MISMATCH');
  }
  if (!timingSafeEqual(hash, claims.params_hash)) return fail('E_PARAMS_MISMATCH');
  return { ok: true, jti: claims.jti, claims };
}
