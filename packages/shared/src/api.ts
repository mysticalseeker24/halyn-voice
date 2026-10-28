import { z } from 'zod';
import { AccountTypeSchema, ActionIdSchema } from './actions';
import { CoreBalanceSchema, CoreTransactionSchema } from './core';
import { ConfirmChannelSchema, HandoffStatusSchema } from './decision';
import type { ErrorDetails } from './errors';
import { OutcomeEventSchema } from './events';
import {
  CustomerIdSchema,
  E164Schema,
  Hex64Schema,
  IdSchema,
  IsoDateTimeSchema,
  Last4Schema,
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
import { LedgerEntrySchema } from './ledger';
import { MoneySchema, PositiveMoneySchema } from './money';
import { LanguageSchema, RegionSchema } from './region';
import {
  AuthenticationCredentialJsonSchema,
  CreationOptionsJsonSchema,
  RegistrationCredentialJsonSchema,
  RequestOptionsJsonSchema,
} from './webauthn';
import { HubRoleSchema } from './ws';

// docs/API.md. Requests from Bolna use z.object (unknown keys are stripped, so a new Bolna context field
// can't break a live call); everything Halyn sends back is strict.

// ── Bolna-facing tools (/tools/*, IP allowlist + x-halyn-secret) ───────────────────────────────────

/** Bolna's call id, auto-injected into every tool (docs/BOLNA.md); maps a call whose run id did not substitute. */
const CallSidSchema = z.string().min(1).max(124).optional();

export const LookupCustomerRequestSchema = z.object({
  run_id: RunIdSchema,
  call_sid: CallSidSchema,
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
  call_sid: CallSidSchema,
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
  call_sid: CallSidSchema,
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
export const GetPassCodeRequestSchema = z.object({
  run_id: RunIdSchema,
  call_sid: CallSidSchema,
  /** Optional on the Assistant call Halyn placed for a Pass (bound to that call; the LLM never copies a token). */
  pass_token: CompactJwsSchema.optional(),
  /** The assistant's calling number; when absent, the Pass must list exactly one number. */
  from_number: E164Schema.optional(),
});
export const GetPassCodeResponseSchema = z.strictObject({ code: PassCodeSchema });

export const ConfirmResultRequestSchema = z.object({
  run_id: RunIdSchema,
  call_sid: CallSidSchema,
  request_id: RequestIdSchema,
  answer: z.enum(['approve', 'decline']),
  method: z.enum(['speech', 'keypad']),
});
export const OkResponseSchema = z.strictObject({ ok: z.boolean() });

/** Fallback polling if event injection fails: returns the event the call would have received. */
export const CheckDecisionRequestSchema = z.object({
  run_id: RunIdSchema,
  call_sid: CallSidSchema,
  request_id: RequestIdSchema,
});
export const CheckDecisionResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({ request_id: RequestIdSchema, status: z.literal('pending') }),
  z.strictObject({ request_id: RequestIdSchema, status: z.literal('decided'), event: OutcomeEventSchema }),
]);

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────────

/** `error.details`: flat and small (≤ 16 scalar values). Aero Core's outcome hint is `CoreOutcomeDetailsSchema`. */
export const ErrorDetailsSchema = z
  .record(z.string().min(1).max(64), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
  .refine((details) => Object.keys(details).length <= 16, 'at most 16 details');

export const ErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: ReasonCodeSchema,
    message: z.string().min(1).max(500),
    /** Optional, so every envelope without it still parses. */
    details: ErrorDetailsSchema.optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export function errorEnvelope(code: ReasonCode, message: string, details?: ErrorDetails): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details: { ...details } } };
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

/**
 * POST /web/ws-ticket `{role}` (Bearer session): a one-time ticket for `GET /ws?ticket=…&role=…`, so the session token
 * never travels in a URL (ADR-021). The role must be one the session may take (customer: aero/assistant; console:
 * stage/console).
 */
export const WsTicketRequestSchema = z.strictObject({ role: HubRoleSchema });
/** Opaque to the apps and URL-safe; opens one socket, for that role, within 30 s (`expires_at`). Never log it. */
export const WsTicketResponseSchema = z.strictObject({
  ticket: z
    .string()
    .min(43)
    .max(256)
    .regex(/^[A-Za-z0-9_.-]+$/, 'expected a URL-safe ticket'),
  expires_at: IsoDateTimeSchema,
});

/** What the customer authorises in the Aero app (docs/PASS.md "Issue"); the passkey challenge binds exactly this. */
export const PassDraftSchema = z.strictObject({
  assistant: AssistantSchema,
  scopes: PassScopesSchema,
  expires_in_days: z.int().min(1).max(30),
});
export type PassDraft = z.input<typeof PassDraftSchema>;
/** POST /web/passes/options → request options whose challenge binds the draft (`ApprovalOptionsResponseSchema`). */
export const PassOptionsRequestSchema = PassDraftSchema;
/** POST /web/passes: the same draft and the passkey assertion over its challenge. */
export const IssuePassRequestSchema = PassDraftSchema.extend({
  response: AuthenticationCredentialJsonSchema,
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
export type PassSummary = z.infer<typeof PassSummarySchema>;
export const IssuePassResponseSchema = z.strictObject({ pass: PassSummarySchema, token: CompactJwsSchema });
export const ListPassesResponseSchema = z.strictObject({ passes: z.array(PassSummarySchema) });
export const RevokePassResponseSchema = z.strictObject({ pass: PassSummarySchema });

/** POST /web/assistant/tasks: the Assistant calls Aero (number B → A) on this Pass, for this task. */
export const AssistantTaskRequestSchema = z.strictObject({
  task: z.string().trim().min(3).max(300),
  pass_id: PassIdSchema,
});
export const AssistantTaskResponseSchema = z.strictObject({
  ok: z.literal(true),
  execution_id: z.string().min(1),
});

export const StageRunRequestSchema = z.strictObject({
  mode: z.enum(['text', 'voice']).default('text'),
  /** Halyn Test: record this scenario's result into that suite run (POST /web/tests/runs). */
  suite_run_id: IdSchema.optional(),
});
export const StageRunResponseSchema = z.strictObject({
  test_run_id: IdSchema,
  scenario: ScenarioIdSchema,
  mode: z.enum(['text', 'voice']),
});
export const StageRegionRequestSchema = z.strictObject({ region: RegionSchema });

/**
 * POST /web/calls/session (customer): mint a Bolna Web Call SDK session for "Call Aero". The region (default: the
 * Stage's) picks the agent; the API registers the call's run id with the signed-in customer, so the call carries the
 * app session as proof (scenario 10). The Bolna key never reaches the browser.
 */
export const WebCallSessionRequestSchema = z.strictObject({ region: RegionSchema.optional() });
/** Bolna's mint response, passed through unchanged to `@bolna/web-call` (single-use, ~120 s). */
export const WebCallSessionSchema = z.looseObject({
  run_id: z.string().min(1).max(128),
  agent_id: z.string().min(1).max(64),
  expires_in: z.number().positive(),
});
export type WebCallSession = z.infer<typeof WebCallSessionSchema>;

/** GET /web/ledger/verify: the chain head, or the first entry whose hash does not check out. */
export const LedgerVerifyResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), entries: z.int().nonnegative(), head_hash: Hex64Schema.nullable() }),
  z.strictObject({ ok: z.literal(false), entries: z.int().nonnegative(), first_bad_seq: z.int().positive() }),
]);

/**
 * A specialist handoff (Console Handoffs; the Hub's read model). `run_id` is the call's Bolna execution — its
 * transcript and recording. A coaching or distress hold also books a check-in call: a record only, no call is placed.
 */
export const HandoffSchema = z.strictObject({
  id: z.string().min(1).max(64),
  request_id: z.string().min(1).max(64),
  call_id: z.string().min(1).max(64),
  run_id: z.string().min(1).max(128),
  customer_id: z.string().max(64).nullable(),
  action: z.string().min(1).max(64),
  summary: z.string().min(1).max(300),
  reasons: z.array(ReasonCodeSchema).max(32),
  reason: ReasonCodeSchema,
  status: HandoffStatusSchema,
  note: z.string().max(500).nullable(),
  checkin: z
    .strictObject({
      at: IsoDateTimeSchema,
      why: z.enum(['coaching', 'distress']),
      status: z.literal('scheduled'),
    })
    .nullable(),
  created_at: IsoDateTimeSchema,
  resolved_at: IsoDateTimeSchema.nullable(),
});
export type Handoff = z.infer<typeof HandoffSchema>;
export const HandoffListResponseSchema = z.strictObject({ handoffs: z.array(HandoffSchema).max(200) });

export const HandoffResolveRequestSchema = z.strictObject({
  action: z.enum(['release', 'block']),
  note: z.string().max(500).optional(),
});
export const HandoffResolveResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: HandoffStatusSchema.exclude(['open']),
});

// ── Aero app: home, passkeys, the Confirm passkey leg (server side Step 7; screens Step 9, apps/web) ─────────────

/** Something the customer should know about, for the Aero app's alert list (newest first). Never a full number. */
export const AeroAlertSchema = z.strictObject({
  id: z.string().min(1).max(64),
  /** blocked: Halyn denied or held it · approval: waiting for the customer · info: anything else. */
  kind: z.enum(['blocked', 'info', 'approval']),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(300),
  at: IsoDateTimeSchema,
});
export type AeroAlert = z.infer<typeof AeroAlertSchema>;

/** A step-up waiting for this customer: the fields of the `confirm_request` WebSocket message. */
export const PendingApprovalSchema = z.strictObject({
  request_id: RequestIdSchema,
  action: ActionIdSchema,
  summary: z.string().min(1).max(300),
  amount: MoneySchema.nullable(),
  channels: z.array(ConfirmChannelSchema).min(1),
  expires_at: IsoDateTimeSchema,
});
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;

/**
 * GET /web/aero/home (customer session). Balances, activity, card and loan come from Aero Core's `statement.view`
 * (with a Halyn grant, like every Aero Core read); `accounts` is empty when Aero Core is unreachable. `last4` is the
 * account number's last 4 digits (never more) and `outstanding` the loan amount still owed.
 */
export const AeroHomeSchema = z.strictObject({
  customer: z.strictObject({ id: CustomerIdSchema, name: z.string().min(1).max(80) }),
  accounts: z.array(
    z.strictObject({ type: AccountTypeSchema, last4: Last4Schema, balance: CoreBalanceSchema }),
  ),
  activity: z.array(CoreTransactionSchema).max(20),
  alerts: z.array(AeroAlertSchema).max(20),
  card: z.strictObject({ last4: Last4Schema, status: z.enum(['active', 'frozen']) }).nullable(),
  loan: z
    .strictObject({
      id: IdSchema,
      emi: PositiveMoneySchema,
      emi_day: z.int().min(1).max(28),
      outstanding: CoreBalanceSchema,
    })
    .nullable(),
  passkey_registered: z.boolean(),
  pending_approvals: z.array(PendingApprovalSchema).max(10),
});
export type AeroHome = z.infer<typeof AeroHomeSchema>;

/** POST /web/passkeys/register/options → WebAuthn creation options (SimpleWebAuthn `optionsJSON`). */
export const PasskeyRegisterOptionsResponseSchema = z.strictObject({ options: CreationOptionsJsonSchema });
/** POST /web/approvals/:id/options → WebAuthn request options bound to this request's exact action. */
export const ApprovalOptionsResponseSchema = z.strictObject({ options: RequestOptionsJsonSchema });
/** Either options response (the web client's generic parser). */
export const WebauthnOptionsResponseSchema = z.union([
  PasskeyRegisterOptionsResponseSchema,
  ApprovalOptionsResponseSchema,
]);

/** POST /web/passkeys/register/verify: `startRegistration()`'s JSON. */
export const PasskeyRegisterVerifyRequestSchema = z.object({ response: RegistrationCredentialJsonSchema });
export const PasskeyRegisterVerifyResponseSchema = z.strictObject({ ok: z.literal(true) });

/**
 * POST /web/approvals/:id/verify: `startAuthentication()`'s JSON. A confirmation answer (invariant 10): if another
 * channel answered first, or the 60 s ran out, it is recorded and refused with 400 E_BAD_REQUEST.
 */
export const ApprovalVerifyRequestSchema = z.object({ response: AuthenticationCredentialJsonSchema });
export const ApprovalVerifyResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: z.literal('approved'),
});
/** POST /web/approvals/:id/decline (body `{}`): no passkey needed, a decline only makes things stricter. */
export const ApprovalDeclineResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: z.literal('declined'),
});

/** GET /web/ledger?limit=N (console): the newest N entries, oldest first, and the Hub's chain head. */
export const LedgerListResponseSchema = z.strictObject({
  entries: z.array(LedgerEntrySchema),
  head_hash: Hex64Schema.nullable(),
});
