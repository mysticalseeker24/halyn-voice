import {
  ActionIdSchema,
  Base64UrlSchema,
  ConfirmChannelSchema,
  CustomerIdSchema,
  DecisionSchema,
  FinalOutcomeSchema,
  Hex64Schema,
  LanguageSchema,
  Last4Schema,
  MoneySchema,
  OutcomeEventSchema,
  OutcomeSchema,
  ReasonCodeSchema,
  RegionSchema,
  RequestIdSchema,
  RunIdSchema,
  WebAuthnAlgorithmSchema,
} from '@halyn/shared';
import { z } from 'zod';
import { ProofSchema, SIGNAL_CODES } from '../gate';
import { PassCodeRowSchema, PassRowSchema } from '../pass';

// The Hub's call-time read model (ADR-016): everything a Bolna tool needs within 300 ms lives in the tenant's Hub
// (Durable Object SQLite), loaded once from TiDB and kept current by the Hub itself; TiDB is the durable mirror,
// written through the Hub's outbox. Rows are stored as JSON and parsed with these schemas on the way out.

/** A customer as the tools see them. `spoken_name` is what voices say (Devanagari for Saksham, CLAUDE.md §8). */
export const DirectoryCustomerSchema = z.strictObject({
  id: CustomerIdSchema,
  name: z.string().min(1).max(80),
  spoken_name: z.string().min(1).max(80),
  region: RegionSchema,
  language: LanguageSchema,
  number_hash: Hex64Schema,
  last4: Last4Schema,
});
export type DirectoryCustomer = z.infer<typeof DirectoryCustomerSchema>;

/** A registered passkey (public key only). */
export const CredentialRecordSchema = z.strictObject({
  id: Base64UrlSchema.max(1366),
  customer_id: CustomerIdSchema,
  alg: WebAuthnAlgorithmSchema,
  /** The public key as a JWK (EC P-256, OKP Ed25519 or RSA). */
  jwk: z.record(z.string(), z.json()),
  sign_count: z.int().nonnegative(),
  created_at: z.iso.datetime(),
});
export type CredentialRecord = z.infer<typeof CredentialRecordSchema>;

/** What the Hub loads from TiDB the first time it serves a tenant. */
export const DirectorySnapshotSchema = z.strictObject({
  customers: z.array(DirectoryCustomerSchema),
  passes: z.array(PassRowSchema),
  codes: z.array(PassCodeRowSchema),
  credentials: z.array(CredentialRecordSchema),
});
export type DirectorySnapshot = z.infer<typeof DirectorySnapshotSchema>;

/** One Bolna call (or web call) as Halyn knows it. */
export const CallStateSchema = z.strictObject({
  id: z.string().min(1).max(64),
  run_id: RunIdSchema,
  call_sid: z.string().max(124).nullable(),
  channel: z.enum(['phone', 'web']),
  region: RegionSchema,
  customer_id: CustomerIdSchema.nullable(),
  /** The calling number is the identified customer's registered number. */
  registered: z.boolean(),
  /** SHA-256(PHONE_HASH_PEPPER ‖ E.164) of the calling number; the number itself is never stored. */
  number_hash: Hex64Schema.nullable(),
  from_last4: Last4Schema.nullable(),
  kind: z.enum(['human', 'ai_assistant', 'unknown']),
  /** A Pass verified on this call (verify_pass). */
  pass_id: z.string().max(64).nullable(),
  app_session_customer_id: CustomerIdSchema.nullable(),
  started_at: z.int().nonnegative(),
  ended_at: z.int().nonnegative().nullable(),
  purpose: z.string().max(32).nullable(),
});
export type CallState = z.infer<typeof CallStateSchema>;

/** The Gate's decision as stored (apps/api/src/gate/types.ts GateDecision). */
export const StoredGateDecisionSchema = z.strictObject({
  action: ActionIdSchema.nullable(),
  outcome: OutcomeSchema,
  tier: z.int().nonnegative().nullable(),
  base_tier: z.int().nonnegative().nullable(),
  proof: ProofSchema,
  signals: z.array(z.enum(SIGNAL_CODES)),
  reasons: z.array(ReasonCodeSchema),
  amount: MoneySchema.nullable(),
  confirm: z
    .strictObject({ channels: z.array(ConfirmChannelSchema), timeout_seconds: z.int().positive() })
    .nullable(),
});

/**
 * Where a request stands. approved → executing → executed | failed; awaiting_confirmation → approved | held | refused;
 * held and refused are final at proposal time.
 */
export const RequestStatusSchema = z.enum([
  'approved',
  'executing',
  'executed',
  'failed',
  'awaiting_confirmation',
  'held',
  'refused',
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const RequestRecordSchema = z.strictObject({
  request_id: RequestIdSchema,
  run_id: RunIdSchema,
  /** `${run_id}:${params_hash}` — invariant 7. */
  idem_key: z.string().min(1).max(200),
  call_id: z.string().min(1).max(64),
  customer_id: CustomerIdSchema.nullable(),
  region: RegionSchema,
  channel: z.enum(['phone', 'web']),
  /** As proposed (an unknown action is kept, truncated, for the record). */
  action: z.string().min(1).max(64),
  params: z.record(z.string(), z.json()),
  params_hash: Hex64Schema,
  readback_confirmed: z.boolean(),
  caller_quotes: z.array(z.string().max(300)).max(5),
  coaching: z.strictObject({ score: z.number().min(0).max(1), cues: z.array(z.string().max(64)) }),
  summary: z.string().min(1).max(300),
  created_at: z.int().nonnegative(),
  gate: StoredGateDecisionSchema,
  decision: DecisionSchema,
  pack_sha: Hex64Schema.nullable(),
  pass_id: z.string().max(64).nullable(),
  status: RequestStatusSchema,
  final_outcome: FinalOutcomeSchema.nullable(),
  execute_at: z.iso.datetime().nullable(),
  confirm: z
    .strictObject({
      channels: z.array(ConfirmChannelSchema).min(1),
      deadline: z.int().nonnegative(),
      execution_id: z.string().max(128).nullable(),
    })
    .nullable(),
  execution: z
    .strictObject({
      jti: z.string().min(1).max(26),
      reference: z.string().min(1).max(64),
      at: z.int().nonnegative(),
      summary: z.string().min(1).max(300),
    })
    .nullable(),
  /** Why execution failed (core_rejected), when it did. */
  failure: ReasonCodeSchema.nullable(),
  handoff_id: z.string().max(64).nullable(),
  /**
   * Coaching layer 2 is still reading the quotes (ADR-024): nothing is claimed, prompted, called or answered until
   * finishScreening clears it or turns the request into a hold. Absent on rows from before Step 11.
   */
  screening: z.boolean().optional(),
  /** The event the call should be in now (check_decision answers with it). */
  last_event: OutcomeEventSchema.nullable(),
});
export type RequestRecord = z.infer<typeof RequestRecordSchema>;

/** A row on its way to TiDB (the Hub's mirror outbox; db/mirror.ts writes each kind). */
export const MIRROR_KINDS = [
  'call',
  'request',
  'decision',
  'grant',
  'confirmation',
  'handoff',
  'pass',
  'pass_row',
  'pass_code',
  'credentials',
] as const;
export const MirrorItemSchema = z.strictObject({
  kind: z.enum(MIRROR_KINDS),
  row: z.record(z.string(), z.json()),
});
export type MirrorItem = z.infer<typeof MirrorItemSchema>;
