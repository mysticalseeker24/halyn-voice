import {
  type ActionId,
  ActionIdSchema,
  type ConfirmChannel,
  CustomerIdSchema,
  E164Schema,
  type Money,
  type Outcome,
  PassScopeSchema,
  type ReasonCode,
  RunIdSchema,
  TenantIdSchema,
} from '@halyn/shared';
import { z } from 'zod';

// docs/GATE.md "Inputs". The Gate validates both with Zod on every call and fails closed on anything else.

export const ProposeRequestSchema = z.strictObject({
  tenant_id: TenantIdSchema,
  run_id: RunIdSchema,
  channel: z.enum(['phone', 'web']),
  caller: z.strictObject({
    from_number: E164Schema.optional(),
    app_session_customer_id: CustomerIdSchema.optional(),
    kind: z.enum(['human', 'ai_assistant', 'unknown']),
  }),
  /** From lookup_customer; null when nobody is identified. */
  customer_id: CustomerIdSchema.nullable(),
  action: ActionIdSchema,
  /** Validated per action with the strict schemas in @halyn/shared. */
  params: z.record(z.string(), z.unknown()),
  /** The agent read the exact details back and heard a clear yes. */
  readback_confirmed: z.boolean(),
  /** The last few caller sentences (max 5, max 300 chars each). */
  caller_quotes: z.array(z.string().max(300)).max(5),
});
export type ProposeRequest = z.infer<typeof ProposeRequestSchema>;

export const PROOFS = ['none', 'registered_number', 'app_session', 'pass'] as const;
export const ProofSchema = z.enum(PROOFS);
export type Proof = z.infer<typeof ProofSchema>;

const CountSchema = z.int().nonnegative();
const PeriodCounterSchema = z.strictObject({ count: CountSchema, amount_minor: CountSchema });

export const GateContextSchema = z
  .strictObject({
    proof: ProofSchema,
    /** The verified Pass for this call: its scopes and how often each action was used. */
    pass: z
      .strictObject({
        scopes: z.array(PassScopeSchema),
        uses: z.partialRecord(ActionIdSchema, CountSchema),
      })
      .optional(),
    counters: z.strictObject({
      /** Use of each action in its limit's current period. Missing = nothing used. */
      per_action_period: z.partialRecord(ActionIdSchema, PeriodCounterSchema),
      transfers_last_10m: CountSchema,
    }),
    signals: z.strictObject({
      unregistered_number: z.boolean(),
      calls_last_hour: CountSchema,
      unusual_hour: z.boolean(),
      liveness: z.number().min(0).max(1).optional(),
    }),
    coaching: z.strictObject({
      score: z.number().min(0).max(1),
      cues: z.array(z.string().max(64)).max(32),
    }),
    distress: z.boolean(),
  })
  .refine((ctx) => (ctx.proof === 'pass') === (ctx.pass !== undefined), {
    path: ['pass'],
    error: 'proof "pass" and a Pass come together',
  });
export type GateContext = z.input<typeof GateContextSchema>;

export const SIGNAL_CODES = [
  'S_UNREGISTERED_NUMBER',
  'S_CALL_BURST',
  'S_UNUSUAL_HOUR',
  'S_LOW_LIVENESS',
  'S_VELOCITY',
] as const satisfies readonly ReasonCode[];
export type SignalCode = (typeof SIGNAL_CODES)[number];

export interface GateDecision {
  /** null only when the request itself could not be read. */
  action: ActionId | null;
  outcome: Outcome;
  /** Base tier + signal weights; null for human-only actions and fail-closed decisions. */
  tier: number | null;
  base_tier: number | null;
  /** Proof after Pass scoping (an out-of-scope Pass counts as none). */
  proof: Proof;
  /** Every signal whose condition held, in a fixed order. */
  signals: SignalCode[];
  reasons: ReasonCode[];
  amount: Money | null;
  /** How the customer is asked to confirm; only on step_up. */
  confirm: { channels: ConfirmChannel[]; timeout_seconds: number } | null;
}

export type StepUpAnswer = 'approved' | 'declined' | 'timeout';

export interface StepUpResolution {
  final_outcome: 'allow' | 'hold' | 'deny';
  /** Codes added by the resolution (merged after the Gate's codes). */
  reasons: ReasonCode[];
  /** When an approved tier-4 action may execute (ISO UTC); null = now or never. */
  execute_at: string | null;
}
