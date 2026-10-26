import { z } from 'zod';
import { type ActionId, ActionIdSchema, isCriticalAction } from './actions';
import {
  Base64UrlSchema,
  CustomerIdSchema,
  E164Schema,
  PassIdSchema,
  TenantIdSchema,
  UnixSecondsSchema,
} from './ids';
import { jwsHeaderSchema } from './jws';
import type { CompiledPolicyPack } from './policy-pack';

// docs/PASS.md — halyn-pass/0.1: a signed permission a customer gives their AI assistant.

export const PASS_VERSION = 'halyn-pass/0.1';
export const PASS_MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** One-time spoken codes: 6 digits, valid 5 minutes, single use; 5 failures lock the Pass. */
export const PASS_CODE = { digits: 6, ttl_seconds: 300, max_failures: 5 } as const;

export const PassScopeSchema = z.strictObject({
  action: ActionIdSchema,
  max_uses: z.int().positive().optional(),
});
export type PassScope = z.infer<typeof PassScopeSchema>;

/** Non-empty, one entry per action, and never a critical action (invariant 5). */
export const PassScopesSchema = z
  .array(PassScopeSchema)
  .min(1)
  .superRefine((scopes, ctx) => {
    const seen = new Set<ActionId>();
    scopes.forEach((scope, i) => {
      if (seen.has(scope.action))
        ctx.addIssue({ code: 'custom', path: [i, 'action'], message: `${scope.action} is listed twice` });
      seen.add(scope.action);
      if (isCriticalAction(scope.action))
        ctx.addIssue({
          code: 'custom',
          path: [i, 'action'],
          message: `${scope.action} is critical and can never be in a Pass (invariant 5)`,
        });
    });
  });

export const AssistantSchema = z.strictObject({
  name: z.string().min(1).max(80),
  numbers: z
    .array(E164Schema)
    .min(1)
    .max(5)
    .refine((numbers) => new Set(numbers).size === numbers.length, 'calling numbers must be unique'),
});

export const PassClaimsSchema = z
  .strictObject({
    v: z.literal(PASS_VERSION),
    pid: PassIdSchema,
    tenant: TenantIdSchema,
    sub: CustomerIdSchema,
    assistant: AssistantSchema,
    scopes: PassScopesSchema,
    iat: UnixSecondsSchema,
    exp: UnixSecondsSchema,
    cnf: z.strictObject({ customer_passkey_sig: Base64UrlSchema }),
  })
  .superRefine((claims, ctx) => {
    if (claims.exp <= claims.iat)
      ctx.addIssue({ code: 'custom', path: ['exp'], message: 'exp must be after iat' });
    else if (claims.exp - claims.iat > PASS_MAX_LIFETIME_SECONDS)
      ctx.addIssue({ code: 'custom', path: ['exp'], message: 'a Pass lasts at most 30 days' });
  });
export type PassClaims = z.infer<typeof PassClaimsSchema>;
export type PassClaimsInput = z.input<typeof PassClaimsSchema>;

/** Media type of a Pass's JWS header. */
export const PASS_TYP = 'halyn-pass+jwt';
export const PassHeaderSchema = jwsHeaderSchema(PASS_TYP);

export const PassStatusSchema = z.enum(['active', 'revoked', 'locked', 'expired']);
export type PassStatus = z.infer<typeof PassStatusSchema>;

export const PassCodeSchema = z.string().regex(/^\d{6}$/, 'expected 6 digits');

/** A code as the agent hears it ("4 7 2 9 1 5", "472-915") → "472915". */
export const PassCodeInputSchema = z
  .string()
  .max(32)
  .transform((code) => code.replace(/[\s-]/g, ''))
  .pipe(PassCodeSchema);

export type PassScopesCheck = { ok: true } | { ok: false; rejected: ActionId[] };

/** At issue time: every scope must be an action this pack offers and marks `pass_eligible`. */
export function passScopesAllowed(scopes: readonly PassScope[], pack: CompiledPolicyPack): PassScopesCheck {
  const rejected = scopes
    .map((s) => s.action)
    .filter((action) => pack.actions[action]?.pass_eligible !== true);
  return rejected.length === 0 ? { ok: true } : { ok: false, rejected };
}
