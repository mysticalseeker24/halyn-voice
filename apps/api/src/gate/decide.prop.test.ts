import {
  ACTION_IDS,
  type ActionId,
  carriesAmount,
  type CompiledPolicyPack,
  compilePolicyPack,
  DecisionSchema,
  isCriticalAction,
  isReasonCode,
  movesMoney,
  outcomeRank,
  type PolicyPackInput,
  PolicyPackSchema,
} from '@halyn/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CLOCK, sampleParams, SOURCE_SHA } from '../../test/fixtures/gate';
import { decide, escalateForCoaching, type GateContext, type ProposeRequest, toDecision } from './index';

// docs/GATE.md "Properties that tests must prove", over arbitrary *valid* policy packs (built through the real
// schema and compiler), not only the two shipped ones.
const RUNS = { numRuns: 300, seed: 20261026 } as const;

type PackActionInput = NonNullable<PolicyPackInput['actions'][ActionId]>;
interface LimitDraft {
  amount_minor?: number | undefined;
  count?: number | undefined;
  per: 'day' | 'month' | 'year';
}

const PERIOD = fc.constantFrom('day' as const, 'month' as const, 'year' as const);

/** Amount limits only on actions that carry an amount; the draft may end up empty (then there is no limit). */
function limitArb(withAmount: boolean): fc.Arbitrary<LimitDraft> {
  return withAmount
    ? fc.record({
        amount_minor: fc.option(fc.integer({ min: 1, max: 10 ** 8 }), { nil: undefined }),
        count: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
        per: PERIOD,
      })
    : fc.record({ count: fc.integer({ min: 1, max: 5 }), per: PERIOD });
}

function actionPolicy(action: ActionId): fc.Arbitrary<PackActionInput> {
  const money = movesMoney(action);
  const amount = carriesAmount(action);
  const agent = fc
    .integer({ min: money ? 1 : 0, max: 4 })
    .chain((tier) =>
      fc.record(
        {
          tier: fc.constant(tier),
          // Tier 0 is only for reads and protective actions (clarification 2); money never is either.
          kind:
            tier === 0
              ? fc.constantFrom('read', 'protective')
              : money
                ? fc.constant('write')
                : fc.constantFrom('write', 'read'),
          pass_eligible: isCriticalAction(action) ? fc.constant(false) : fc.boolean(),
          limit: fc.option(limitArb(amount), { nil: undefined }),
          cap: amount
            ? fc.option(fc.integer({ min: 1, max: 10 ** 8 }), { nil: undefined })
            : fc.constant(undefined),
          above: amount
            ? fc.option(fc.integer({ min: 1, max: 10 ** 8 }), { nil: undefined })
            : fc.constant(undefined),
          hold_hours: tier === 4 ? fc.integer({ min: 1, max: 168 }) : fc.constant(undefined),
        },
        // hold_hours is present exactly at tier 4, so it is always generated (undefined below tier 4).
        { requiredKeys: ['tier', 'kind', 'pass_eligible', 'hold_hours'] },
      ),
    )
    .map((a): PackActionInput => {
      const l = a.limit;
      const limit =
        l && (l.amount_minor !== undefined || l.count !== undefined)
          ? {
              per: l.per,
              ...(l.amount_minor !== undefined ? { amount_minor: l.amount_minor } : {}),
              ...(l.count !== undefined ? { count: l.count } : {}),
            }
          : undefined;
      return {
        tier: a.tier,
        pass_eligible: a.pass_eligible,
        ...(a.kind === 'read' ? { read: true } : {}),
        ...(a.kind === 'protective' ? { protective: true } : {}),
        ...(limit ? { limit } : {}),
        ...(a.cap !== undefined ? { cap_first_24h_minor: a.cap } : {}),
        ...(a.above !== undefined ? { human_only_above_minor: a.above } : {}),
        ...(a.hold_hours !== undefined ? { hold_hours: a.hold_hours } : {}),
      };
    });
  return fc.oneof(
    { arbitrary: agent, weight: 4 },
    { arbitrary: fc.constant({ perimeter: 'human_only' as const }), weight: 1 },
  );
}

const weight = fc.integer({ min: 0, max: 4 });

const packArb: fc.Arbitrary<CompiledPolicyPack> = fc
  .record({
    region: fc.constantFrom('IN' as const, 'US' as const),
    ids: fc.subarray([...ACTION_IDS], { minLength: 1 }),
    threshold: fc.integer({ min: 1, max: 100 }),
    timeout: fc.integer({ min: 10, max: 600 }),
    channels: fc.subarray(['passkey', 'callback'] as const, { minLength: 1 }),
    signals: fc.record({
      unregistered_number: weight,
      calls_last_hour_gte_3: weight,
      unusual_hour: weight,
      liveness_below_0_3: weight,
      transfers_last_10m_gte_2: weight,
    }),
  })
  .chain((p) =>
    fc.tuple(fc.constant(p), fc.tuple(...p.ids.map((id) => actionPolicy(id).map((a) => [id, a] as const)))),
  )
  .map(([p, entries]) =>
    compilePolicyPack(
      PolicyPackSchema.parse({
        pack: 'prop-pack',
        version: 1,
        region: p.region,
        currency: p.region === 'IN' ? 'INR' : 'USD',
        coaching: { threshold: p.threshold / 100 },
        confirm: { timeout_seconds: p.timeout, channels: p.channels },
        actions: Object.fromEntries(entries),
        signals: p.signals,
        handoff: { specialist_number_env: 'SPECIALIST_NUMBER' },
      }),
      SOURCE_SHA,
    ),
  );

interface Case {
  pack: CompiledPolicyPack;
  req: ProposeRequest;
  ctx: GateContext;
}

/** The quiet value 4 times in 5, otherwise anything. */
function quietly<Q, A>(quiet: fc.Arbitrary<Q>, any: fc.Arbitrary<A>): fc.Arbitrary<Q | A> {
  return fc.oneof({ arbitrary: quiet, weight: 4 }, { arbitrary: any, weight: 1 });
}

const caseArb: fc.Arbitrary<Case> = packArb.chain((pack) => {
  const offered = Object.keys(pack.actions) as ActionId[];
  return fc
    .record({
      action: fc.constantFrom(...offered),
      amount: fc.integer({ min: 1, max: 10 ** 8 }),
      readback: fc.boolean(),
      customer: fc.boolean(),
      channel: fc.constantFrom('phone' as const, 'web' as const),
      kind: fc.constantFrom('human' as const, 'ai_assistant' as const, 'unknown' as const),
      proof: fc.constantFrom(
        'none' as const,
        'registered_number' as const,
        'app_session' as const,
        'pass' as const,
      ),
      scopes: fc.subarray([...ACTION_IDS]),
      maxUses: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
      used: fc.integer({ min: 0, max: 3 }),
      counter: fc.record({
        count: fc.integer({ min: 0, max: 3 }),
        amount_minor: fc.integer({ min: 0, max: 10 ** 8 }),
      }),
      // Mostly quiet contexts, so "the first signal arrives" (the edge monotonicity is about) is common.
      transfers: quietly(fc.constant(0), fc.integer({ min: 0, max: 5 })),
      unregistered: quietly(fc.constant(false), fc.constant(true)),
      calls: quietly(fc.constant(0), fc.integer({ min: 0, max: 6 })),
      unusual: quietly(fc.constant(false), fc.constant(true)),
      liveness: quietly(fc.constant(undefined), fc.integer({ min: 0, max: 100 })),
      coaching: quietly(fc.constant(0), fc.integer({ min: 0, max: 100 })),
      distress: quietly(fc.constant(false), fc.constant(true)),
    })
    .map((g): Case => {
      const req: ProposeRequest = {
        tenant_id: 'ten_aero',
        run_id: 'run_prop',
        channel: g.channel,
        caller: { from_number: '+919000000003', kind: g.kind },
        customer_id: g.customer ? 'cus_saksham' : null,
        action: g.action,
        params: sampleParams(g.action, pack.currency, g.amount),
        readback_confirmed: g.readback,
        caller_quotes: [],
      };
      const ctx: GateContext = {
        proof: g.proof,
        counters: { per_action_period: { [g.action]: g.counter }, transfers_last_10m: g.transfers },
        signals: {
          unregistered_number: g.unregistered,
          calls_last_hour: g.calls,
          unusual_hour: g.unusual,
          ...(g.liveness !== undefined ? { liveness: g.liveness / 100 } : {}),
        },
        coaching: { score: g.coaching / 100, cues: [] },
        distress: g.distress,
        ...(g.proof === 'pass'
          ? {
              pass: {
                scopes: g.scopes.map((action) => (g.maxUses ? { action, max_uses: g.maxUses } : { action })),
                uses: { [g.action]: g.used },
              },
            }
          : {}),
      };
      return { pack, req, ctx };
    });
});

const run = ({ req, ctx, pack }: Case) => decide(req, ctx, pack, CLOCK);

const ADD_SIGNAL: Record<string, (ctx: GateContext) => GateContext> = {
  unregistered: (c) => ({ ...c, signals: { ...c.signals, unregistered_number: true } }),
  burst: (c) => ({
    ...c,
    signals: { ...c.signals, calls_last_hour: Math.max(3, c.signals.calls_last_hour) },
  }),
  hour: (c) => ({ ...c, signals: { ...c.signals, unusual_hour: true } }),
  liveness: (c) => ({ ...c, signals: { ...c.signals, liveness: 0.1 } }),
  velocity: (c) => ({
    ...c,
    counters: { ...c.counters, transfers_last_10m: Math.max(2, c.counters.transfers_last_10m) },
  }),
};

/** Same data, every object's keys in reverse insertion order (deeply). */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    ) as T;
  return value;
}

describe('Gate properties (fast-check)', () => {
  it('adding any one signal never makes the outcome more permissive', () => {
    fc.assert(
      fc.property(caseArb, fc.constantFrom(...Object.keys(ADD_SIGNAL)), (c, signal) => {
        const before = run(c);
        const after = run({ ...c, ctx: ADD_SIGNAL[signal]!(c.ctx) });
        expect(outcomeRank(after.outcome)).toBeGreaterThanOrEqual(outcomeRank(before.outcome));
      }),
      { ...RUNS, numRuns: 2000 },
    );
  });

  it('signals never lower the tier: tier ≥ base_tier', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const d = run(c);
        if (d.tier !== null && d.base_tier !== null) expect(d.tier).toBeGreaterThanOrEqual(d.base_tier);
        expect(d.tier === null).toBe(d.base_tier === null);
      }),
      RUNS,
    );
  });

  it('coaching ≥ threshold on a money-moving action never yields allow or step_up', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        fc.pre(movesMoney(c.req.action));
        const coached = {
          ...c.ctx,
          coaching: { score: Math.max(c.ctx.coaching.score, c.pack.coaching.threshold), cues: [] },
        };
        const d = run({ ...c, ctx: coached });
        expect(['hold', 'deny']).toContain(d.outcome);
      }),
      RUNS,
    );
  });

  it('a late coaching score (layer 2) escalates exactly as deciding with it would, and never lowers', () => {
    fc.assert(
      fc.property(caseArb, fc.double({ min: 0, max: 1, noNaN: true }), (c, late) => {
        const first = run(c);
        const escalated = escalateForCoaching(first, late, c.pack);
        const score = Math.max(c.ctx.coaching.score, late);
        const again = run({ ...c, ctx: { ...c.ctx, coaching: { score, cues: [] } } });
        // Only an allow or step_up is ever screened; a hold or deny is final as decided.
        if (first.outcome !== 'allow' && first.outcome !== 'step_up') expect(escalated).toBeNull();
        else expect(escalated ?? first).toEqual(again);
      }),
      { ...RUNS, numRuns: 1000 },
    );
  });

  it('a non-pass-eligible action never gains proof from a Pass, and no allow relies on one', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const d = run(c);
        const policy = c.pack.actions[c.req.action];
        if (d.proof === 'pass') expect(policy?.pass_eligible).toBe(true);
        if (c.ctx.proof === 'pass' && policy && !policy.pass_eligible && d.outcome === 'allow')
          expect(policy.protective).toBe(true);
      }),
      RUNS,
    );
  });

  it('readback_confirmed = false on a write never yields allow', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        fc.pre(c.pack.actions[c.req.action]?.read === false);
        const d = run({ ...c, req: { ...c.req, readback_confirmed: false } });
        expect(d.outcome).not.toBe('allow');
      }),
      RUNS,
    );
  });

  it('is deterministic, including when every object lists its keys in a different order', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const first = run(c);
        expect(run(c)).toEqual(first);
        const shuffled = run({ pack: reverseKeys(c.pack), req: reverseKeys(c.req), ctx: reverseKeys(c.ctx) });
        expect(JSON.stringify(shuffled)).toBe(JSON.stringify(first));
      }),
      RUNS,
    );
  });

  // Step 7: limits only ever tighten. An allow fits inside the period limit, and more prior use never loosens.
  it('an allow never exceeds the period limit, and more prior use never loosens the outcome', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.integer({ min: 0, max: 10 ** 8 }),
        fc.integer({ min: 0, max: 3 }),
        (c, more, extra) => {
          const d = run(c);
          const policy = c.pack.actions[c.req.action];
          const used = c.ctx.counters.per_action_period[c.req.action] ?? { count: 0, amount_minor: 0 };
          if (d.outcome === 'allow' && policy?.limit && !policy.protective) {
            if (policy.limit.count !== null) expect(used.count + 1).toBeLessThanOrEqual(policy.limit.count);
            if (policy.limit.amount_minor !== null && d.amount)
              expect(used.amount_minor + d.amount.amount_minor).toBeLessThanOrEqual(
                policy.limit.amount_minor,
              );
          }
          const busier: GateContext = {
            ...c.ctx,
            counters: {
              ...c.ctx.counters,
              per_action_period: {
                [c.req.action]: { count: used.count + extra, amount_minor: used.amount_minor + more },
              },
            },
          };
          expect(outcomeRank(run({ ...c, ctx: busier }).outcome)).toBeGreaterThanOrEqual(
            outcomeRank(d.outcome),
          );
        },
      ),
      RUNS,
    );
  });

  // Step 5: with nobody identified there is no one to show data to and no one to confirm a step-up.
  it('with no customer identified, only protective actions are ever allowed or stepped up', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const d = run({ ...c, req: { ...c.req, customer_id: null } });
        if (d.outcome === 'allow' || d.outcome === 'step_up')
          expect(c.pack.actions[c.req.action]?.protective).toBe(true);
      }),
      RUNS,
    );
  });

  it('every decision has unique, known reason codes and converts to a shared Decision', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const d = run(c);
        expect(d.reasons.length).toBeGreaterThan(0);
        expect(new Set(d.reasons).size).toBe(d.reasons.length);
        for (const code of d.reasons) expect(isReasonCode(code)).toBe(true);
        expect(DecisionSchema.safeParse(toDecision(d, 'req_01JABCDEFGHJKMNPQRSTVWXYZ0')).success).toBe(true);
        if (d.outcome === 'hold') expect(d.reasons).toContain('H_SPECIALIST');
        expect(d.confirm !== null).toBe(d.outcome === 'step_up');
      }),
      RUNS,
    );
  });
});
