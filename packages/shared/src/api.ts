import { z } from 'zod';
import { HandoffStatusSchema } from './decision';
import { OutcomeEventSchema } from './events';
import {
  CustomerIdSchema,
  E164Schema,
  Hex64Schema,
  IdSchema,
  IsoDateTimeSchema,
  PassIdSchema,
  RequestIdSchema,
  RunIdSchema,
  ScenarioIdSchema,
  TenantIdSchema,
} from './ids';
import { CompactJwsSchema } from './jws';
import {
  AssistantSchema,
  PassCodeInputSchema,
  PassCodeSchema,
  PassScopeSchema,
  PassScopesSchema,
  PassStatusSchema,
} from './pass';
import { type ReasonCode, ReasonCodeSchema } from './reason-codes';
import { LanguageSchema, RegionSchema } from './region';

// docs/API.md. Requests from Bolna use z.object (unknown keys are stripped, so a new Bolna context field
// can't break a live call); everything Halyn sends back is strict.

// ── Bolna-facing tools (/tools/*, IP allowlist + x-halyn-secret) ───────────────────────────────────

export const LookupCustomerRequestSchema = z.object({
  run_id: RunIdSchema,
  from_number: E164Schema,
  claimed_name: z.string().min(1).max(80).optional(),
});
export const LookupCustomerResponseSchema = z.strictObject({
  customer_found: z.boolean(),
  customer_name: z.string().min(1).max(80).optional(),
  region: RegionSchema.optional(),
  registered: z.boolean(),
  language: LanguageSchema.optional(),
});

export const VerifyPassRequestSchema = z.object({
  run_id: RunIdSchema,
  from_number: E164Schema,
  code: PassCodeInputSchema,
});
/** Never echoes the code. */
export const VerifyPassResponseSchema = z.strictObject({
  valid: z.boolean(),
  assistant_name: z.string().min(1).max(80).optional(),
  scopes_summary: z.string().min(1).max(300).optional(),
});

/** docs/GATE.md: the last few caller sentences, at most 5, at most 300 chars each. */
export const CALLER_QUOTES = { max: 5, max_chars: 300 } as const;

/**
 * The envelope only. Per-action params are checked with `parseActionParams`; an unknown action or bad params
 * becomes a recorded `deny` with E_FAIL_CLOSED (the caller still hears an outcome), not an HTTP 400.
 * Extra or over-long caller quotes are trimmed rather than rejected.
 */
export const ProposeActionRequestSchema = z.object({
  run_id: RunIdSchema,
  from_number: E164Schema.optional(),
  channel: z.enum(['phone', 'web']),
  action: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()),
  readback_confirmed: z.boolean(),
  caller_quotes: z
    .array(z.string().max(2000))
    .max(20)
    .default([])
    .transform((quotes) => quotes.slice(-CALLER_QUOTES.max).map((q) => q.slice(0, CALLER_QUOTES.max_chars))),
});
export type ProposeActionRequest = z.output<typeof ProposeActionRequestSchema>;

/** Answered within 300 ms; the outcome arrives later as an event. */
export const ProposeActionResponseSchema = z.strictObject({
  request_id: RequestIdSchema,
  status: z.literal('pending'),
});

/** Assistant only: trade the Pass token for a fresh one-time code. */
export const GetPassCodeRequestSchema = z.object({ run_id: RunIdSchema, pass_token: CompactJwsSchema });
export const GetPassCodeResponseSchema = z.strictObject({ code: PassCodeSchema });

export const ConfirmResultRequestSchema = z.object({
  run_id: RunIdSchema,
  request_id: RequestIdSchema,
  answer: z.enum(['approve', 'decline']),
  method: z.enum(['speech', 'keypad']),
});
export const OkResponseSchema = z.strictObject({ ok: z.boolean() });

/** Fallback polling if event injection fails: returns the event the call would have received. */
export const CheckDecisionRequestSchema = z.object({ run_id: RunIdSchema, request_id: RequestIdSchema });
export const CheckDecisionResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({ request_id: RequestIdSchema, status: z.literal('pending') }),
  z.strictObject({ request_id: RequestIdSchema, status: z.literal('decided'), event: OutcomeEventSchema }),
]);

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────────

export const ErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({ code: ReasonCodeSchema, message: z.string().min(1).max(500) }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export function errorEnvelope(code: ReasonCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

// ── Web (/web/*, session token) — only the endpoints docs/API.md specifies well enough so far ────────

export const SessionRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('customer'), customer_id: CustomerIdSchema }),
  z.strictObject({ kind: z.literal('console') }),
]);
export const SessionResponseSchema = z.strictObject({
  token: z.string().min(16).max(4096),
  tenant_id: TenantIdSchema,
  kind: z.enum(['customer', 'console']),
  customer_id: CustomerIdSchema.nullable(),
  expires_at: IsoDateTimeSchema,
});

/** The customer issues a Pass in the Aero app and approves it with their passkey (docs/PASS.md). */
export const IssuePassRequestSchema = z.strictObject({
  assistant: AssistantSchema,
  scopes: PassScopesSchema,
  expires_in_days: z.int().min(1).max(30),
  /** WebAuthn assertion JSON; verified server-side with @simplewebauthn (Step 10). */
  webauthn: z.record(z.string(), z.unknown()),
});
export const PassSummarySchema = z.strictObject({
  id: PassIdSchema,
  assistant_name: z.string().min(1).max(80),
  assistant_numbers: z.array(E164Schema).min(1),
  scopes: z.array(PassScopeSchema),
  status: PassStatusSchema,
  issued_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
});
export const IssuePassResponseSchema = z.strictObject({ pass: PassSummarySchema, token: CompactJwsSchema });
export const ListPassesResponseSchema = z.strictObject({ passes: z.array(PassSummarySchema) });

export const StageRunRequestSchema = z.strictObject({ mode: z.enum(['text', 'voice']).default('text') });
export const StageRunResponseSchema = z.strictObject({
  test_run_id: IdSchema,
  scenario: ScenarioIdSchema,
  mode: z.enum(['text', 'voice']),
});
export const StageRegionRequestSchema = z.strictObject({ region: RegionSchema });

/** GET /web/ledger/verify: the chain head, or the first entry whose hash does not check out. */
export const LedgerVerifyResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), entries: z.int().nonnegative(), head_hash: Hex64Schema.nullable() }),
  z.strictObject({ ok: z.literal(false), entries: z.int().nonnegative(), first_bad_seq: z.int().positive() }),
]);

export const HandoffResolveRequestSchema = z.strictObject({
  action: z.enum(['release', 'block']),
  note: z.string().max(500).optional(),
});
export const HandoffResolveResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: HandoffStatusSchema.exclude(['open']),
});
