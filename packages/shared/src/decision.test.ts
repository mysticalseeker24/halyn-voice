import { describe, expect, it } from 'vitest';
import {
  compareStrictness,
  CONFIRM_CHANNELS,
  type Decision,
  DecisionSchema,
  HandoffStatusSchema,
  isAtLeastAsStrict,
  OUTCOMES,
  outcomeRank,
} from './decision';

describe('outcomes', () => {
  it('are ordered allow < step_up < hold = deny', () => {
    expect(OUTCOMES).toEqual(['allow', 'step_up', 'hold', 'deny']);
    expect(OUTCOMES.map(outcomeRank)).toEqual([0, 1, 2, 2]);
    expect(compareStrictness('allow', 'step_up')).toBe(-1);
    expect(compareStrictness('hold', 'deny')).toBe(0);
    expect(compareStrictness('deny', 'step_up')).toBe(1);
    expect(isAtLeastAsStrict('hold', 'step_up')).toBe(true);
    expect(isAtLeastAsStrict('allow', 'step_up')).toBe(false);
  });

  it('know the confirmation channels and handoff states', () => {
    expect(CONFIRM_CHANNELS).toEqual(['passkey', 'callback']);
    expect(HandoffStatusSchema.options).toEqual(['open', 'released', 'blocked']);
  });
});

describe('DecisionSchema', () => {
  // Scenario 3: unregistered number raises tier 3 → 4; the customer declines.
  const decision = (): Decision => ({
    request_id: 'req_01J9Z8X7W6V5T4S3R2Q1P0N9M8',
    outcome: 'step_up',
    final_outcome: 'deny',
    tier: 4,
    base_tier: 3,
    reasons: ['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER', 'C_DECLINED'],
  });

  it('accepts a step-up that ended in a deny', () => {
    expect(DecisionSchema.parse(decision())).toEqual(decision());
  });

  it('accepts tierless decisions (human-only perimeter, readback)', () => {
    expect(
      DecisionSchema.safeParse({
        request_id: 'req_x1',
        outcome: 'hold',
        tier: null,
        base_tier: null,
        reasons: ['P_HUMAN_ONLY', 'T_DISTRESS'],
      }).success,
    ).toBe(true);
  });

  it.each<[string, Partial<Record<keyof Decision, unknown>>]>([
    ['no reasons', { reasons: [] }],
    ['a repeated reason', { reasons: ['C_DECLINED', 'C_DECLINED'] }],
    ['an unknown reason', { reasons: ['P_MAGIC'] }],
    ['a final outcome after allow', { outcome: 'allow' }],
    ['step_up as a final outcome', { final_outcome: 'step_up' }],
    ['signals lowering the tier', { tier: 2 }],
    ['a base tier above 4', { base_tier: 5, tier: 5 }],
    ['only one of tier and base tier', { tier: null }],
  ])('rejects %s', (_, change) => {
    expect(DecisionSchema.safeParse({ ...decision(), ...change }).success).toBe(false);
  });
});
