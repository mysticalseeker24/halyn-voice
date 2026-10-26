import {
  type CoreActionId,
  type GrantClaims,
  HalynError,
  type Jwks,
  parseActionParams,
  type ProposedAction,
} from '@halyn/shared';
import { verifyGrant, type VerifyGrantCode } from '@halyn/sdk';

// Invariant 1 at the bank's door: no grant, no action. @halyn/sdk checks, in order: present → EdDSA signature by a key
// in Halyn's JWKS → claims (iss halyn, aud aero-core, ≤ 120 s) → the action is one this route performs → the tenant is
// this bank's → not issued in the future → not expired (no leeway) → SHA-256 of the canonical params equals
// params_hash. Single use is checked when the write runs: the jti goes into used_grants in the same D1 batch.
// The route then acts only on the accounts of `claims.sub`.

export type CoreProposal = Extract<ProposedAction, { action: CoreActionId }>;

export interface GrantCheck {
  /** The `x-halyn-grant` header. */
  token: string | null | undefined;
  /** Reads the request's params; called only once a grant is present. */
  params: () => Promise<unknown>;
  /** What this route executes (`POST /core/transfers` serves three actions). */
  actions: readonly CoreActionId[];
  jwks: Jwks;
  /** This bank's Halyn tenant: a grant for any other tenant is invalid. */
  tenant: string;
  nowMs: number;
}

export interface VerifiedGrant {
  jti: string;
  claims: GrantClaims;
  /** The signed action with its params, validated against the action's strict schema. */
  proposed: CoreProposal;
}

const MESSAGES: Record<VerifyGrantCode, string> = {
  E_GRANT_MISSING: 'An x-halyn-grant header is required',
  E_GRANT_INVALID: 'The grant is not valid for this request',
  E_GRANT_EXPIRED: 'The grant has expired',
  E_PARAMS_MISMATCH: 'The request parameters do not match the grant',
};

export async function requireGrant(check: GrantCheck): Promise<VerifiedGrant> {
  if (typeof check.token !== 'string' || check.token.trim() === '')
    throw new HalynError('E_GRANT_MISSING', MESSAGES.E_GRANT_MISSING);
  const params = await check.params();
  const result = await verifyGrant(check.token, {
    jwks: check.jwks,
    expectedAction: check.actions,
    params,
    now: check.nowMs,
    expectedTenant: check.tenant,
  });
  if (!result.ok) throw new HalynError(result.code, MESSAGES[result.code]);
  // The hash matched, so these are exactly the params Halyn signed. Halyn validates params before signing; a signed
  // grant over params outside the action's schema is still refused here, before anything runs.
  const proposed = parseActionParams(result.claims.action, params);
  if (!proposed.ok)
    throw new HalynError('E_BAD_REQUEST', 'The granted parameters are not valid for this action');
  // verifyGrant accepted claims.action only because it is in check.actions, which are all CoreActionIds.
  return { jti: result.jti, claims: result.claims, proposed: proposed.value as CoreProposal };
}
