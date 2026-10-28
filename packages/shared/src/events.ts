import { z } from 'zod';
import { ConfirmChannelSchema, type Outcome } from './decision';
import { RequestIdSchema } from './ids';
import { ReasonCodeSchema } from './reason-codes';

// Outcome events Halyn injects into a live call: POST https://api.bolna.ai/v1/call/{run_id}/events
// with { event, properties }. The Aero graph agent only reaches outcome nodes through these (docs/BOLNA.md);
// `recorded` goes to the Confirm call once its answer is stored, so the Confirm graph says goodbye and hangs up.

export const OUTCOME_EVENT_NAMES = [
  'allow',
  'done',
  'step_up',
  'approved',
  'denied',
  'timeout',
  'hold',
  'deny',
  'recorded',
] as const;
export type OutcomeEventName = (typeof OUTCOME_EVENT_NAMES)[number];

const request = { request_id: RequestIdSchema };
const refusal = { request_id: RequestIdSchema, reason: ReasonCodeSchema };
const event = <E extends OutcomeEventName, P extends z.ZodType>(name: E, properties: P) =>
  z.strictObject({ event: z.literal(name), properties });

export const OutcomeEventSchema = z.discriminatedUnion('event', [
  event('allow', z.strictObject(request)),
  /** `summary` is spoken to the caller: no full account or card numbers. */
  event(
    'done',
    z.strictObject({ reference: z.string().min(1).max(64), summary: z.string().min(1).max(300) }),
  ),
  event(
    'step_up',
    z.strictObject({
      ...request,
      channels: z
        .array(ConfirmChannelSchema)
        .min(1)
        .refine((c) => new Set(c).size === c.length, 'channels must be unique'),
    }),
  ),
  event('approved', z.strictObject(request)),
  event('denied', z.strictObject(refusal)),
  event('timeout', z.strictObject(refusal)),
  event('hold', z.strictObject(refusal)),
  event('deny', z.strictObject(refusal)),
  event('recorded', z.strictObject(request)),
]);
export type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;

const FIRST_EVENT = {
  allow: 'allow',
  step_up: 'step_up',
  hold: 'hold',
  deny: 'deny',
} as const satisfies Record<Outcome, OutcomeEventName>;

/** The first event a call receives for a Gate outcome. */
export function eventForOutcome(outcome: Outcome): OutcomeEventName {
  return FIRST_EVENT[outcome];
}
