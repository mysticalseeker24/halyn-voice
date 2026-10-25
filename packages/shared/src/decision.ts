import { z } from 'zod';
import { RequestIdSchema } from './ids';
import { ReasonCodeSchema } from './reason-codes';

export const OUTCOMES = ['allow', 'step_up', 'hold', 'deny'] as const;
export const OutcomeSchema = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** After a step-up the customer's answer settles it: approved → allow, declined/timeout → deny, cap → hold. */
export const FinalOutcomeSchema = z.enum(['allow', 'hold', 'deny']);

// Strictness for the Gate's monotonicity property: allow < step_up < hold = deny.
const RANK: Record<Outcome, number> = { allow: 0, step_up: 1, hold: 2, deny: 2 };

export function outcomeRank(outcome: Outcome): number {
  return RANK[outcome];
}

export function compareStrictness(a: Outcome, b: Outcome): -1 | 0 | 1 {
  return Math.sign(RANK[a] - RANK[b]) as -1 | 0 | 1;
}

export function isAtLeastAsStrict(a: Outcome, b: Outcome): boolean {
  return RANK[a] >= RANK[b];
}

export const CONFIRM_CHANNELS = ['passkey', 'callback'] as const;
export const ConfirmChannelSchema = z.enum(CONFIRM_CHANNELS);
export type ConfirmChannel = z.infer<typeof ConfirmChannelSchema>;

export const HandoffStatusSchema = z.enum(['open', 'released', 'blocked']);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

/**
 * A Gate decision. `tier`/`base_tier` are null when no tier applies (readback deny, human-only perimeter).
 * Signals only raise the tier, so `tier ≥ base_tier`.
 */
export const DecisionSchema = z
  .strictObject({
    request_id: RequestIdSchema,
    outcome: OutcomeSchema,
    final_outcome: FinalOutcomeSchema.optional(),
    tier: z.int().nonnegative().nullable(),
    base_tier: z.int().min(0).max(4).nullable(),
    reasons: z.array(ReasonCodeSchema).min(1),
  })
  .superRefine((d, ctx) => {
    if (new Set(d.reasons).size !== d.reasons.length)
      ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'reason codes must be unique' });
    if (d.final_outcome !== undefined && d.outcome !== 'step_up')
      ctx.addIssue({
        code: 'custom',
        path: ['final_outcome'],
        message: 'only a step_up has a final outcome',
      });
    if ((d.tier === null) !== (d.base_tier === null))
      ctx.addIssue({
        code: 'custom',
        path: ['tier'],
        message: 'tier and base_tier are both set or both null',
      });
    else if (d.tier !== null && d.base_tier !== null && d.tier < d.base_tier)
      ctx.addIssue({ code: 'custom', path: ['tier'], message: 'signals never lower the tier' });
  });
export type Decision = z.infer<typeof DecisionSchema>;
