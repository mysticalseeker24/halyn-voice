import type { Clock, CompiledPolicyPack } from '@halyn/shared';
import type { GateDecision, StepUpAnswer, StepUpResolution } from './types';

// docs/GATE.md "After step_up" and clarification 9. First answer wins and the 60 s timer live in the Hub; this only
// turns that answer into the final outcome. Pure apart from the injected clock. Any error → deny E_FAIL_CLOSED.

const HOUR_MS = 3_600_000;
const DEFAULT_HOLD_HOURS = 24;
const FAIL_CLOSED: StepUpResolution = { final_outcome: 'deny', reasons: ['E_FAIL_CLOSED'], execute_at: null };

function resolve(
  decision: GateDecision,
  answer: StepUpAnswer,
  pack: CompiledPolicyPack,
  clock: Clock,
): StepUpResolution {
  if (decision.outcome !== 'step_up' || decision.action === null || decision.tier === null)
    return FAIL_CLOSED;
  if (answer === 'declined') return { final_outcome: 'deny', reasons: ['C_DECLINED'], execute_at: null };
  if (answer === 'timeout') return { final_outcome: 'deny', reasons: ['C_TIMEOUT'], execute_at: null };
  if (answer !== 'approved') return FAIL_CLOSED;

  const policy = pack.actions[decision.action];
  if (policy?.perimeter !== 'agent') return FAIL_CLOSED;
  // A brand-new payee may receive at most the cap in its first 24 h; above it a specialist takes over.
  const cap = policy.cap_first_24h_minor;
  if (cap !== null && decision.amount && decision.amount.amount_minor > cap)
    return {
      final_outcome: 'hold',
      reasons: ['C_APPROVED', 'P_OVER_LIMIT', 'H_SPECIALIST'],
      execute_at: null,
    };
  if (decision.tier >= 4) {
    const hours = policy.hold_hours ?? DEFAULT_HOLD_HOURS;
    return {
      final_outcome: 'allow',
      reasons: ['C_APPROVED', 'P_TIER4_HOLD_24H'],
      execute_at: new Date(clock.nowMs() + hours * HOUR_MS).toISOString(),
    };
  }
  return { final_outcome: 'allow', reasons: ['C_APPROVED'], execute_at: null };
}

/** Turn the customer's answer to a step-up into the final outcome. Never throws. */
export function resolveStepUp(
  decision: GateDecision,
  answer: StepUpAnswer,
  pack: CompiledPolicyPack,
  clock: Clock,
): StepUpResolution {
  try {
    return resolve(decision, answer, pack, clock);
  } catch {
    return FAIL_CLOSED;
  }
}
