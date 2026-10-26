import { ACTION_IDS, type ActionId, type CompiledPolicyPack, DecisionSchema } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import {
  CLOCK,
  context,
  IN_PACK,
  inPackWith,
  PASS,
  request,
  sampleParams,
  US_PACK,
} from '../../test/fixtures/gate';
import { decide, type GateContext, type ProposeRequest, resolveStepUp, toDecision } from './index';

// Adversarial inputs for the Gate (test-engineer pass): boundaries, malformed values, every caller kind without a
// customer, and aliasing. Rules are cited by their docs/GATE.md step or clarification number.

const FAIL_CLOSED = { outcome: 'deny', reasons: ['E_FAIL_CLOSED'], tier: null, base_tier: null };

function gate(req: ProposeRequest, ctx: GateContext = context(), pack: CompiledPolicyPack = IN_PACK) {
  return decide(req, ctx, pack, CLOCK);
}

const offered = (pack: CompiledPolicyPack) => Object.keys(pack.actions) as ActionId[];

describe('clarification 1: each region fails closed on what it does not offer', () => {
  it.each(ACTION_IDS.filter((a) => !offered(US_PACK).includes(a)))('US pack: %s', (action) => {
    const req = request(action, { params: sampleParams(action, 'USD') });
    expect(gate(req, context(), US_PACK)).toMatchObject(FAIL_CLOSED);
  });

  it.each(ACTION_IDS.filter((a) => !offered(IN_PACK).includes(a)))('IN pack: %s', (action) => {
    expect(gate(request(action, { params: sampleParams(action, 'INR') }))).toMatchObject(FAIL_CLOSED);
  });

  it('an INR amount under the US pack fails closed', () => {
    const req = request('transfer.saved', { params: sampleParams('transfer.saved', 'INR') });
    expect(gate(req, context(), US_PACK)).toMatchObject(FAIL_CLOSED);
  });
});

describe('invariant 9 + clarification 1: amounts are positive safe integers in minor units', () => {
  it.each<[string, unknown]>([
    ['zero', 0],
    ['negative', -100],
    ['a fraction of a paisa', 100.5],
    ['a string', '60000'],
    ['above MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('%s fails closed', (_, amount) => {
    const params = { ...sampleParams('transfer.saved'), amount_minor: amount };
    expect(gate(request('transfer.saved', { params }))).toMatchObject(FAIL_CLOSED);
  });

  it('1 paisa is a valid amount', () => {
    const d = gate(request('fee.waive', { params: sampleParams('fee.waive', 'INR', 1) }));
    expect(d).toMatchObject({ outcome: 'allow', amount: { amount_minor: 1, currency: 'INR' } });
  });

  it('MAX_SAFE_INTEGER is over every amount limit (step_up), never an overflow into allow', () => {
    const params = sampleParams('transfer.saved', 'INR', Number.MAX_SAFE_INTEGER);
    const d = gate(request('transfer.saved', { params }));
    expect(d.outcome).toBe('step_up');
    expect(d.reasons).toContain('P_OVER_LIMIT');
  });

  it('MAX_SAFE_INTEGER above human_only_above_minor holds (US wire)', () => {
    const params = sampleParams('wire.new', 'USD', Number.MAX_SAFE_INTEGER);
    expect(gate(request('wire.new', { params }), context(), US_PACK)).toMatchObject({
      outcome: 'hold',
      reasons: expect.arrayContaining(['P_HUMAN_ONLY_ABOVE_LIMIT', 'H_SPECIALIST']) as unknown,
    });
  });
});

describe('extra or hostile params keys fail closed (the grant binds the exact params)', () => {
  it.each<[string, ActionId, Record<string, unknown>]>([
    [
      'an override flag on a transfer',
      'transfer.new_payee',
      { ...sampleParams('transfer.new_payee'), approved: true },
    ],
    ['an admin claim', 'transfer.saved', { ...sampleParams('transfer.saved'), role: 'admin' }],
    // Zod's record parse drops an own "__proto__" key; the Gate must still see it and fail closed.
    [
      'a __proto__ key from a JSON body',
      'card.freeze',
      JSON.parse('{"card_last4":"8812","__proto__":{"admin":true}}') as Record<string, unknown>,
    ],
    ['a constructor key', 'card.freeze', { card_last4: '8812', constructor: 'x' }],
  ])('%s', (_, action, params) => {
    expect(gate(request(action, { params }))).toMatchObject(FAIL_CLOSED);
  });
});

describe('clarification 8: limits at and beyond their edges', () => {
  // fee.waive (IN): ₹1,000 a year, once.
  const used = (count: number, amount_minor: number) =>
    context({ counters: { per_action_period: { 'fee.waive': { count, amount_minor } } } });

  it('exactly the amount limit with nothing used → allow', () => {
    const d = gate(request('fee.waive', { params: sampleParams('fee.waive', 'INR', 100000) }));
    expect(d).toMatchObject({ outcome: 'allow', reasons: ['P_WITHIN_LIMIT'] });
  });

  it('limit + 1 → step_up P_OVER_LIMIT', () => {
    const d = gate(request('fee.waive', { params: sampleParams('fee.waive', 'INR', 100001) }));
    expect(d).toMatchObject({ outcome: 'step_up', reasons: ['P_OVER_LIMIT'] });
  });

  it('counters already beyond the amount limit → step_up, even for 1 paisa', () => {
    const req = request('fee.waive', { params: sampleParams('fee.waive', 'INR', 1) });
    expect(gate(req, used(0, 250000)).outcome).toBe('step_up');
  });

  it('counters already beyond the count limit → step_up', () => {
    expect(gate(request('fee.waive'), used(7, 0)).outcome).toBe('step_up');
  });

  it('counters at MAX_SAFE_INTEGER do not overflow into allow', () => {
    const req = request('fee.waive', { params: sampleParams('fee.waive', 'INR', 1) });
    expect(gate(req, used(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).outcome).toBe('step_up');
  });
});

describe('step 6: signal inputs at their edges', () => {
  it.each<[string, Partial<GateContext['signals']>]>([
    ['liveness NaN', { liveness: Number.NaN }],
    ['liveness above 1', { liveness: 1.2 }],
    ['negative liveness', { liveness: -0.1 }],
    ['fractional calls_last_hour', { calls_last_hour: 2.5 }],
    ['Infinity calls_last_hour', { calls_last_hour: Number.POSITIVE_INFINITY }],
  ])('%s fails closed', (_, signals) => {
    expect(gate(request(), context({ signals }))).toMatchObject(FAIL_CLOSED);
  });

  it('liveness 0 fires S_LOW_LIVENESS; liveness 1 does not', () => {
    expect(gate(request(), context({ signals: { liveness: 0 } })).signals).toEqual(['S_LOW_LIVENESS']);
    expect(gate(request(), context({ signals: { liveness: 1 } })).signals).toEqual([]);
  });

  it('a coaching score of NaN fails closed (never "below threshold")', () => {
    const d = gate(request('transfer.new_payee'), context({ coaching: { score: Number.NaN } }));
    expect(d).toMatchObject(FAIL_CLOSED);
  });
});

describe('clarification 7: Pass edge cases', () => {
  it('uses beyond max_uses → out of scope', () => {
    const pass = { ...PASS, uses: { 'emi.move_date': 5 } };
    const d = gate(request('emi.move_date'), context({ proof: 'pass', pass }));
    expect(d.reasons).toContain('X_PASS_OUT_OF_SCOPE');
    expect(d.proof).toBe('none');
  });

  it('a Pass that lists a critical action never grants proof for it (invariant 5)', () => {
    const pass = { scopes: [{ action: 'transfer.new_payee' as const }], uses: {} };
    const d = gate(request('transfer.new_payee'), context({ proof: 'pass', pass }));
    expect(d).toMatchObject({ outcome: 'step_up', proof: 'none' });
    expect(d.reasons).toEqual(expect.arrayContaining(['X_PASS_OUT_OF_SCOPE', 'I_NO_PROOF']));
  });

  it('a Pass in scope for the protective card freeze still just allows it', () => {
    const d = gate(request('card.freeze'), context({ proof: 'pass', pass: PASS }));
    expect(d).toMatchObject({ outcome: 'allow', reasons: ['P_TIER0', 'X_PASS_IN_SCOPE', 'P_PROTECTIVE'] });
  });
});

describe('step 5: no customer identified, for every action the IN pack offers', () => {
  it.each(offered(IN_PACK))('%s is never allowed unless protective', (action) => {
    const policy = IN_PACK.actions[action];
    const d = gate(request(action, { customer_id: null }), context({ proof: 'none' }));
    if (policy?.protective)
      expect(d).toMatchObject({ outcome: 'allow', reasons: ['P_TIER0', 'P_PROTECTIVE'] });
    else if (policy?.perimeter === 'human_only') expect(d.outcome).toBe('hold');
    else
      expect(d).toMatchObject({
        outcome: 'deny',
        reasons: expect.arrayContaining(['I_NO_PROOF']) as unknown,
      });
  });

  it('a coached money transfer with no customer is held, not merely denied (coaching comes first)', () => {
    const d = gate(
      request('transfer.new_payee', { customer_id: null }),
      context({ proof: 'none', coaching: { score: 0.9 } }),
    );
    expect(d.outcome).toBe('hold');
  });
});

describe('step 3: coaching boundaries', () => {
  it('upi.raise_limit counts as money-moving (docs/ACTIONS.md): coached → hold', () => {
    const d = gate(request('upi.raise_limit'), context({ coaching: { score: 0.6 } }));
    expect(d).toMatchObject({ outcome: 'hold', reasons: expect.arrayContaining(['S_COACHING']) as unknown });
  });

  it('a coached card freeze is still allowed (not money-moving; freezing protects the victim)', () => {
    expect(gate(request('card.freeze'), context({ coaching: { score: 1 } })).outcome).toBe('allow');
  });

  it('the threshold comes from the pack', () => {
    const strict = inPackWith((p) => void (p.coaching.threshold = 0.3));
    expect(gate(request('transfer.saved'), context({ coaching: { score: 0.3 } }), strict).outcome).toBe(
      'hold',
    );
  });
});

describe('outputs never alias inputs', () => {
  it('mutating the request, context or pack after decide() leaves the decision unchanged', () => {
    const req = request('transfer.new_payee');
    const ctx = context({ signals: { unusual_hour: true } });
    const pack = inPackWith(() => undefined);
    const d = decide(req, ctx, pack, CLOCK);
    const snapshot = JSON.stringify(d);
    (req.params as { amount_minor: number }).amount_minor = 1;
    ctx.signals.unusual_hour = false;
    pack.confirm.channels.splice(0);
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('mutating a decision leaves the pack and later decisions unchanged', () => {
    const pack = inPackWith(() => undefined);
    const first = decide(request('transfer.new_payee'), context(), pack, CLOCK);
    first.confirm?.channels.splice(0);
    first.reasons.splice(0);
    first.signals.push('S_VELOCITY');
    const second = decide(request('transfer.new_payee'), context(), pack, CLOCK);
    expect(second.confirm?.channels).toEqual(['passkey', 'callback']);
    expect(second.reasons).toEqual(['P_TIER3_STEP_UP']);
    expect(second.signals).toEqual([]);
  });
});

describe('post-approval edges (clarification 9)', () => {
  const stepUp = (amount: number) =>
    gate(request('transfer.new_payee', { params: sampleParams('transfer.new_payee', 'INR', amount) }));

  it('approved new payee exactly at the first-24 h cap → allow now', () => {
    expect(resolveStepUp(stepUp(1000000), 'approved', IN_PACK, CLOCK)).toEqual({
      final_outcome: 'allow',
      reasons: ['C_APPROVED'],
      execute_at: null,
    });
  });

  it('one paisa above the cap → hold for a specialist', () => {
    expect(resolveStepUp(stepUp(1000001), 'approved', IN_PACK, CLOCK).final_outcome).toBe('hold');
  });

  it('a resolution never resurrects a fail-closed decision', () => {
    const failed = gate(request('wire.new', { params: sampleParams('wire.new') }));
    for (const answer of ['approved', 'declined', 'timeout'] as const)
      expect(resolveStepUp(failed, answer, IN_PACK, CLOCK)).toMatchObject({ final_outcome: 'deny' });
  });

  it('toDecision of a step-up and its resolution is a valid shared Decision', () => {
    const d = stepUp(4500000);
    const decision = toDecision(
      d,
      'req_01JABCDEFGHJKMNPQRSTVWXYZ0',
      resolveStepUp(d, 'declined', IN_PACK, CLOCK),
    );
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision).toMatchObject({ outcome: 'step_up', final_outcome: 'deny' });
  });
});
