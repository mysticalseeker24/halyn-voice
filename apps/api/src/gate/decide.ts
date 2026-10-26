import {
  type ActionId,
  actionAmount,
  type Clock,
  type CompiledAction,
  type CompiledPolicyPack,
  type Money,
  movesMoney,
  type Outcome,
  packAction,
  parseActionParams,
  type ReasonCode,
} from '@halyn/shared';
import {
  type GateContext,
  GateContextSchema,
  type GateDecision,
  type Proof,
  type ProposeRequest,
  ProposeRequestSchema,
  type SignalCode,
} from './types';

// The Gate (docs/GATE.md): a pure function of request, context and policy pack. First matching rule wins, in the
// documented order; "Clarifications" settles every choice the rules leave open. Any error → deny E_FAIL_CLOSED.

type AgentAction = Extract<CompiledAction, { perimeter: 'agent' }>;
type Context = ReturnType<typeof GateContextSchema.parse>;

/** Clarification 4: the code for a tier (base or computed). Tier 1 has none here; ≥ 5 is the specialist. */
function tierCode(tier: number): ReasonCode | null {
  if (tier >= 5) return 'H_SPECIALIST';
  return (['P_TIER0', null, 'P_TIER2', 'P_TIER3_STEP_UP', 'P_TIER4_HOLD_24H'] as const)[tier] ?? null;
}

function failClosed(action: ActionId | null): GateDecision {
  return {
    action,
    outcome: 'deny',
    tier: null,
    base_tier: null,
    proof: 'none',
    signals: [],
    reasons: ['E_FAIL_CLOSED'],
    amount: null,
    confirm: null,
  };
}

/** Step 6 + clarification 5: every signal whose condition holds, with the pack's weight. */
function firedSignals(req: ProposeRequest, ctx: Context, pack: CompiledPolicyPack) {
  const ignoreNumber = ctx.proof === 'app_session' || req.channel === 'web';
  const { liveness } = ctx.signals;
  const all: [SignalCode, boolean, number][] = [
    [
      'S_UNREGISTERED_NUMBER',
      ctx.signals.unregistered_number && !ignoreNumber,
      pack.signals.unregistered_number,
    ],
    ['S_CALL_BURST', ctx.signals.calls_last_hour >= 3, pack.signals.calls_last_hour_gte_3],
    ['S_UNUSUAL_HOUR', ctx.signals.unusual_hour, pack.signals.unusual_hour],
    ['S_LOW_LIVENESS', liveness !== undefined && liveness < 0.3, pack.signals.liveness_below_0_3],
    ['S_VELOCITY', ctx.counters.transfers_last_10m >= 2, pack.signals.transfers_last_10m_gte_2],
  ];
  const fired = all.filter(([, holds]) => holds);
  return { codes: fired.map(([code]) => code), weight: fired.reduce((sum, [, , w]) => sum + w, 0) };
}

/** Clarification 7: in scope = listed, uses left, and the pack marks the action Pass-eligible. */
function passInScope(action: ActionId, policy: CompiledAction, pass: NonNullable<Context['pass']>): boolean {
  const scope = pass.scopes.find((s) => s.action === action);
  if (!scope || !policy.pass_eligible) return false;
  return scope.max_uses === undefined || (pass.uses[action] ?? 0) < scope.max_uses;
}

/** Clarification 8. Written as a subtraction so the check cannot overflow. */
function overLimit(action: ActionId, policy: AgentAction, amount: Money | null, ctx: Context): boolean {
  const { limit } = policy;
  if (!limit) return false;
  const used = ctx.counters.per_action_period[action] ?? { count: 0, amount_minor: 0 };
  if (limit.amount_minor !== null && amount && amount.amount_minor > limit.amount_minor - used.amount_minor)
    return true;
  return limit.count !== null && used.count + 1 > limit.count;
}

/** Steps 6–8: the tier table with limits. Reads without proof never get here (clarification 2). */
function tierOutcome(tier: number, proven: boolean, over: boolean): Outcome {
  if (tier >= 5) return 'hold';
  let outcome: Outcome;
  if (proven) outcome = tier <= 2 ? 'allow' : 'step_up';
  else outcome = tier === 0 ? 'deny' : 'step_up';
  return over && outcome === 'allow' ? 'step_up' : outcome;
}

function evaluate(request: ProposeRequest, context: GateContext, pack: CompiledPolicyPack): GateDecision {
  const parsedRequest = ProposeRequestSchema.safeParse(request);
  if (!parsedRequest.success) return failClosed(null);
  const req = parsedRequest.data;
  const parsedContext = GateContextSchema.safeParse(context);
  if (!parsedContext.success) return failClosed(req.action);
  const ctx = parsedContext.data;

  // Clarification 1: unoffered action, bad params or a foreign currency fail closed.
  const policy = packAction(pack, req.action);
  if (!policy) return failClosed(req.action);
  // The raw params, not the record Zod returned: its record parse silently drops an own "__proto__" key, which the
  // strict per-action schema must see (and reject) instead.
  const proposed = parseActionParams(req.action, request.params);
  if (!proposed.ok) return failClosed(req.action);
  const amount = actionAmount(proposed.value);
  if (amount && amount.currency !== pack.currency) return failClosed(req.action);

  const baseTier = policy.tier;
  const signals = firedSignals(req, ctx, pack);
  const tier = baseTier === null ? null : baseTier + signals.weight;
  let proof: Proof = ctx.proof;
  let passCode: ReasonCode | null = null;
  if (ctx.pass) {
    const inScope = passInScope(req.action, policy, ctx.pass);
    proof = inScope ? 'pass' : 'none';
    passCode = inScope ? 'X_PASS_IN_SCOPE' : 'X_PASS_OUT_OF_SCOPE';
  }

  // Clarification 4: base tier, signals, Pass, then the deciding rule's codes; each code once.
  const prefix: ReasonCode[] = [
    ...(baseTier === null ? [] : [tierCode(baseTier)]),
    ...signals.codes,
    passCode,
  ].filter((c): c is ReasonCode => c !== null);
  const decided = (outcome: Outcome, rule: (ReasonCode | null | false)[]): GateDecision => ({
    action: req.action,
    outcome,
    tier,
    base_tier: baseTier,
    proof,
    signals: signals.codes,
    reasons: [...new Set([...prefix, ...rule.filter((c): c is ReasonCode => typeof c === 'string')])],
    amount,
    confirm:
      outcome === 'step_up'
        ? { channels: [...pack.confirm.channels], timeout_seconds: pack.confirm.timeout_seconds }
        : null,
  });

  // 1. Readback: writes need the exact details read back and a clear yes.
  if (!policy.read && !req.readback_confirmed) return decided('deny', ['R_READBACK_NOT_CONFIRMED']);

  // 2. Distress and the human-only perimeter; every applicable code (clarification 3: holds add H_SPECIALIST).
  const perimeter: ReasonCode[] = [];
  if (ctx.distress) perimeter.push('T_DISTRESS');
  if (policy.perimeter === 'human_only') perimeter.push('P_HUMAN_ONLY');
  else if (
    policy.human_only_above_minor !== null &&
    amount &&
    amount.amount_minor > policy.human_only_above_minor
  )
    perimeter.push('P_HUMAN_ONLY_ABOVE_LIMIT');
  if (perimeter.length > 0) return decided('hold', [...perimeter, 'H_SPECIALIST']);
  if (policy.perimeter !== 'agent' || tier === null) return failClosed(req.action);

  // 3. Coaching → hold, never step-up (a coached victim would approve the step-up).
  if (movesMoney(req.action) && ctx.coaching.score >= pack.coaching.threshold)
    return decided('hold', ['S_COACHING', 'H_SPECIALIST']);

  // 4. Protective actions are allowed with any proof, even none.
  if (policy.protective) return decided('allow', ['P_PROTECTIVE']);

  // 5. Proof. Nobody identified → nothing to show and nobody to confirm a step-up.
  if (req.customer_id === null) return decided('deny', ['I_NO_PROOF']);
  // Clarification 2: a read without proof is denied at any tier.
  if (policy.read && proof === 'none') return decided('deny', ['I_NO_PROOF']);

  // 6–8. Tier, limits, tier table.
  const over = overLimit(req.action, policy, amount, ctx);
  const outcome = tierOutcome(tier, proof !== 'none', over);
  return decided(outcome, [
    tier === 1 ? outcome === 'allow' && 'P_WITHIN_LIMIT' : tierCode(tier),
    over && 'P_OVER_LIMIT',
    proof === 'none' && outcome !== 'allow' && 'I_NO_PROOF',
    outcome === 'hold' && 'H_SPECIALIST',
  ]);
}

/**
 * Decide a proposed action. Pure and deterministic: no I/O, no clock reads (the clock is accepted so the signature
 * matches docs/GATE.md; only `resolveStepUp` uses it). Never throws: any error is `deny` `E_FAIL_CLOSED`.
 */
export function decide(
  request: ProposeRequest,
  context: GateContext,
  pack: CompiledPolicyPack,
  _clock: Clock,
): GateDecision {
  try {
    return evaluate(request, context, pack);
  } catch {
    return failClosed(null);
  }
}
