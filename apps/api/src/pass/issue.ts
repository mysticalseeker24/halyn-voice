import {
  type ActionId,
  AssistantSchema,
  Base64UrlSchema,
  type Clock,
  type CompiledPolicyPack,
  CustomerIdSchema,
  HalynError,
  isCriticalAction,
  newId,
  PASS_MAX_LIFETIME_SECONDS,
  PASS_VERSION,
  type PassClaims,
  PassScopeSchema,
  PassScopesSchema,
  passScopesAllowed,
  type Rng,
  TenantIdSchema,
} from '@halyn/shared';
import { z } from 'zod';
import type { PassRow } from './types';

// docs/PASS.md "Issue": the customer picks the assistant, Pass-eligible actions and an expiry (≤ 30 days) and approves
// with their passkey (verified by the caller, Step 10). Critical or non-eligible actions are refused here (invariant 5).

const DAY_SECONDS = 86_400;

const IssuePassInputSchema = z.strictObject({
  tenant: TenantIdSchema,
  customer_id: CustomerIdSchema,
  assistant: AssistantSchema,
  scopes: z.array(PassScopeSchema).min(1),
  expires_in_days: z
    .int()
    .min(1)
    .max(PASS_MAX_LIFETIME_SECONDS / DAY_SECONDS),
  customer_passkey_sig: Base64UrlSchema,
});
export type IssuePassInput = z.input<typeof IssuePassInputSchema>;

export type IssuePassResult =
  | { ok: true; claims: PassClaims }
  | { ok: false; code: 'X_PASS_INVALID'; rejected: ActionId[]; message: string };

const invalid = (message: string, rejected: ActionId[] = []): IssuePassResult => ({
  ok: false,
  code: 'X_PASS_INVALID',
  rejected,
  message,
});

export function issuePass(
  input: IssuePassInput,
  pack: CompiledPolicyPack,
  clock: Clock,
  rng: Rng,
): IssuePassResult {
  const parsed = IssuePassInputSchema.safeParse(input);
  if (!parsed.success) return invalid(z.prettifyError(parsed.error));
  const req = parsed.data;
  const check = passScopesAllowed(req.scopes, pack);
  const rejected = [
    ...new Set([
      ...req.scopes.map((s) => s.action).filter(isCriticalAction),
      ...(check.ok ? [] : check.rejected),
    ]),
  ];
  if (rejected.length > 0) return invalid(`not Pass-eligible here: ${rejected.join(', ')}`, rejected);
  if (!PassScopesSchema.safeParse(req.scopes).success) return invalid('each action may appear once');

  // Every part was validated above, so these claims satisfy PassClaimsSchema (signPass re-checks before signing).
  const iat = Math.floor(clock.nowMs() / 1000);
  const claims: PassClaims = {
    v: PASS_VERSION,
    pid: newId('pass', clock, rng),
    tenant: req.tenant,
    sub: req.customer_id,
    assistant: req.assistant,
    scopes: req.scopes,
    iat,
    exp: iat + req.expires_in_days * DAY_SECONDS,
    cnf: { customer_passkey_sig: req.customer_passkey_sig },
  };
  return { ok: true, claims };
}

/** The `passes` row for a signed Pass: active, no failures, Halyn's signature kept for audit. */
export function passRow(claims: PassClaims, token: string): PassRow {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[2])
    throw new HalynError('E_FAIL_CLOSED', 'passRow: not a signed compact JWS');
  return {
    id: claims.pid,
    tenant_id: claims.tenant,
    customer_id: claims.sub,
    assistant_name: claims.assistant.name,
    assistant_numbers: [...claims.assistant.numbers],
    scopes: claims.scopes.map((s) => ({ ...s })),
    issued_at: new Date(claims.iat * 1000).toISOString(),
    expires_at: new Date(claims.exp * 1000).toISOString(),
    status: 'active',
    customer_sig: claims.cnf.customer_passkey_sig,
    issuer_sig: parts[2],
    failures: 0,
    revoked_at: null,
  };
}
