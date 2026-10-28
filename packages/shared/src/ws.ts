import { z } from 'zod';
import { ActionIdSchema } from './actions';
import { ConfirmChannelSchema, DecisionSchema, HandoffStatusSchema } from './decision';
import {
  CustomerIdSchema,
  Hex64Schema,
  IdSchema,
  IsoDateTimeSchema,
  RequestIdSchema,
  RunIdSchema,
  ScenarioIdSchema,
} from './ids';
import { MoneySchema } from './money';
import { ReasonCodeSchema } from './reason-codes';

// Hub (Durable Object) → apps over WebSocket. Every message carries its type and a UTC timestamp.

export const HUB_ROLES = ['stage', 'console', 'aero', 'assistant'] as const;
export const HubRoleSchema = z.enum(HUB_ROLES);
export type HubRole = z.infer<typeof HubRoleSchema>;

export const WS_MESSAGE_TYPES = [
  'decision',
  'confirm_request',
  'confirm_resolved',
  'core_update',
  'handoff',
  'ledger_append',
  'call_update',
  'test_progress',
] as const;

const message = <T extends (typeof WS_MESSAGE_TYPES)[number], S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), at: IsoDateTimeSchema, ...shape });

export const WsMessageSchema = z.discriminatedUnion('type', [
  /** `cues`: coaching cue ids (never the caller's words), for the Console's live view. */
  message('decision', {
    action: ActionIdSchema,
    decision: DecisionSchema,
    cues: z.array(z.string().min(1).max(64)).max(32).optional(),
  }),
  /** Drives the Aero app's approval sheet: the exact action, then Approve with passkey / Decline. */
  message('confirm_request', {
    request_id: RequestIdSchema,
    action: ActionIdSchema,
    summary: z.string().min(1).max(300),
    amount: MoneySchema.nullable(),
    channels: z.array(ConfirmChannelSchema).min(1),
    expires_at: IsoDateTimeSchema,
  }),
  message('confirm_resolved', {
    request_id: RequestIdSchema,
    status: z.enum(['approved', 'declined', 'timeout']),
    channel: ConfirmChannelSchema.nullable(),
  }),
  message('core_update', {
    customer_id: CustomerIdSchema,
    balance: MoneySchema,
    activity: z
      .strictObject({
        reference: z.string().min(1).max(64),
        summary: z.string().min(1).max(300),
        amount: MoneySchema.nullable(),
      })
      .nullable(),
  }),
  message('handoff', {
    handoff_id: IdSchema,
    request_id: RequestIdSchema,
    reasons: z.array(ReasonCodeSchema).min(1),
    status: HandoffStatusSchema,
  }),
  message('ledger_append', {
    seq: z.int().positive(),
    entry_type: z.string().regex(/^[a-z][a-z_]*$/),
    ref_id: z.string().min(1).max(64),
    hash: Hex64Schema,
    prev_hash: Hex64Schema,
    chain_ok: z.boolean(),
  }),
  message('call_update', {
    run_id: RunIdSchema,
    agent: z.enum(['aero', 'confirm', 'assistant', 'tester']),
    speaker: z.enum(['caller', 'agent', 'system']),
    text: z.string().min(1).max(2000),
  }),
  message('test_progress', {
    test_run_id: IdSchema,
    scenario_id: ScenarioIdSchema,
    status: z.enum(['running', 'passed', 'failed']),
    completed: z.int().nonnegative(),
    total: z.int().positive(),
  }).refine((m) => m.completed <= m.total, { path: ['completed'], error: 'completed cannot exceed total' }),
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;
