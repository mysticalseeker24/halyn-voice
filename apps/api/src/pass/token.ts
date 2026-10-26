import {
  HalynError,
  PASS_TYP,
  type PassClaims,
  PassClaimsSchema,
  type Signer,
  signCompactJws,
  verifyCompactJws,
} from '@halyn/shared';

// The Pass token the assistant holds (compact JWS, EdDSA, typ halyn-pass+jwt). Revocation and locking live on the
// `passes` row, so a valid token is necessary but never sufficient: the caller also checks the row.

/** Accepted clock skew for `iat` (the token cannot be from the future). */
const IAT_SKEW_MS = 5000;

export async function signPass(claims: PassClaims, signer: Signer): Promise<string> {
  const parsed = PassClaimsSchema.safeParse(claims);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', 'signPass: invalid Pass claims');
  return signCompactJws({ alg: 'EdDSA', kid: signer.kid, typ: PASS_TYP }, parsed.data, signer.key);
}

export type VerifyPassTokenResult = { ok: true; claims: PassClaims } | { ok: false };

export async function verifyPassToken(
  token: unknown,
  keys: ReadonlyMap<string, CryptoKey>,
  nowMs: number,
): Promise<VerifyPassTokenResult> {
  const jws = await verifyCompactJws(token, keys, PASS_TYP);
  if (!jws.ok) return { ok: false };
  const claims = PassClaimsSchema.safeParse(jws.payload);
  if (!claims.success) return { ok: false };
  if (claims.data.exp * 1000 <= nowMs || claims.data.iat * 1000 > nowMs + IAT_SKEW_MS) return { ok: false };
  return { ok: true, claims: claims.data };
}
