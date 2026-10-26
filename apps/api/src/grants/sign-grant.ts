import {
  type ActionId,
  type Clock,
  GRANT_MAX_TTL_SECONDS,
  GRANT_TYP,
  GRANT_VERSION,
  type GrantClaims,
  GrantClaimsSchema,
  HalynError,
  newUlid,
  paramsHash,
  parseActionParams,
  type Rng,
  type Signer,
  signCompactJws,
} from '@halyn/shared';

// Invariant 1: the only way anything executes is a one-time grant Halyn signs for the exact params. Pure: the clock
// and rng are injected; any problem throws HalynError E_FAIL_CLOSED so the caller denies.

export const DEFAULT_GRANT_TTL_SECONDS = 60;

export interface GrantRequest {
  tenant: string;
  /** The customer the action is for. */
  sub: string;
  action: ActionId;
  params: unknown;
  request_id: string;
}

export interface SignedGrant {
  /** Compact JWS for the `x-halyn-grant` header. */
  token: string;
  claims: GrantClaims;
}

export async function signGrant(
  request: GrantRequest,
  signer: Signer,
  clock: Clock,
  rng: Rng,
  ttlSeconds: number = DEFAULT_GRANT_TTL_SECONDS,
): Promise<SignedGrant> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > GRANT_MAX_TTL_SECONDS)
    throw new HalynError('E_FAIL_CLOSED', `signGrant: lifetime must be 1–${GRANT_MAX_TTL_SECONDS} s`);
  const proposed = parseActionParams(request.action, request.params);
  if (!proposed.ok) throw new HalynError('E_FAIL_CLOSED', `signGrant: ${proposed.error}`);
  const iat = Math.floor(clock.nowMs() / 1000);
  const claims = GrantClaimsSchema.safeParse({
    v: GRANT_VERSION,
    jti: newUlid(clock, rng),
    iss: 'halyn',
    aud: 'aero-core',
    tenant: request.tenant,
    sub: request.sub,
    action: proposed.value.action,
    params_hash: await paramsHash(proposed.value.params),
    request_id: request.request_id,
    iat,
    exp: iat + ttlSeconds,
  });
  if (!claims.success) throw new HalynError('E_FAIL_CLOSED', 'signGrant: claims failed validation');
  const token = await signCompactJws(
    { alg: 'EdDSA', kid: signer.kid, typ: GRANT_TYP },
    claims.data,
    signer.key,
  );
  return { token, claims: claims.data };
}
