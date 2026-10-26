import type { Decision } from '@halyn/shared';
import type { GateDecision, StepUpResolution } from './types';

/** The shared Decision (ledger, Hub `decision` message, check_decision) for a Gate decision and its resolution. */
export function toDecision(
  decision: GateDecision,
  request_id: string,
  resolution?: StepUpResolution,
): Decision {
  const reasons = [...new Set([...decision.reasons, ...(resolution?.reasons ?? [])])];
  return {
    request_id,
    outcome: decision.outcome,
    ...(resolution ? { final_outcome: resolution.final_outcome } : {}),
    tier: decision.tier,
    base_tier: decision.base_tier,
    reasons,
  };
}
