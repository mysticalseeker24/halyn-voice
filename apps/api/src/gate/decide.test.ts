import { type CompiledPolicyPack, DecisionSchema, type ReasonCode } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import {
  CLOCK,
  context,
  type ContextOverrides,
  IN_PACK,
  inPackWith,
  PASS,
  request,
  sampleParams,
  UNREGISTERED,
  US_PACK,
} from '../../test/fixtures/gate';
import { decide, escalateForCoaching, type GateContext, type ProposeRequest, toDecision } from './index';

// docs/GATE.md: evaluation order, tier table and the Clarifications section. Test names cite the rule they prove.

const FAIL_CLOSED = ['E_FAIL_CLOSED'];

function gate(
  req: ProposeRequest = request(),
  ctx: GateContext = context(),
  pack: CompiledPolicyPack = IN_PACK,
) {
  return decide(req, ctx, pack, CLOCK);
}

/** The IN pack with `unusual_hour` weighted so one signal lifts the tier by exactly `weight`. */
function packWithHourWeight(weight: number) {
  return inPackWith((p) => void (p.signals.unusual_hour = weight));
}

const PROVEN = ['registered_number', 'app_session', 'pass'] as const;

function proofContext(proof: (typeof PROVEN)[number], extra: ContextOverrides = {}) {
  return context({ proof, ...(proof === 'pass' ? { pass: PASS } : {}), ...extra });
}

describe('tier table (step 8) — a write: fee.waive, base tier 1', () => {
  // computed tier = 1 + unusual_hour weight; the expected rule codes are the row code (+ I_NO_PROOF without proof).
  const rows: [number, 'allow' | 'step_up' | 'hold', ReasonCode[], 'step_up' | 'hold', ReasonCode[]][] = [
    [1, 'allow', ['P_WITHIN_LIMIT'], 'step_up', ['I_NO_PROOF']],
    [2, 'allow', ['P_TIER2'], 'step_up', ['P_TIER2', 'I_NO_PROOF']],
    [3, 'step_up', ['P_TIER3_STEP_UP'], 'step_up', ['P_TIER3_STEP_UP', 'I_NO_PROOF']],
    [4, 'step_up', ['P_TIER4_HOLD_24H'], 'step_up', ['P_TIER4_HOLD_24H', 'I_NO_PROOF']],
    [5, 'hold', ['H_SPECIALIST'], 'hold', ['H_SPECIALIST', 'I_NO_PROOF']],
  ];

  for (const [tier, provenOutcome, provenCodes, noneOutcome, noneCodes] of rows) {
    const pack = packWithHourWeight(tier - 1);
    const signals = tier > 1 ? { unusual_hour: true } : {};
    const signalCodes: ReasonCode[] = tier > 1 ? ['S_UNUSUAL_HOUR'] : [];

    for (const proof of PROVEN) {
      it(`tier ${tier} × proof ${proof} → ${provenOutcome}`, () => {
        const d = gate(request('fee.waive'), proofContext(proof, { signals }), pack);
        expect(d.outcome).toBe(provenOutcome);
        expect(d.tier).toBe(tier);
        expect(d.base_tier).toBe(1);
        expect(d.reasons).toEqual([
          ...signalCodes,
          ...(proof === 'pass' ? (['X_PASS_IN_SCOPE'] as const) : []),
          ...provenCodes,
        ]);
      });
    }

    it(`tier ${tier} × proof none → ${noneOutcome}`, () => {
      const d = gate(request('fee.waive'), context({ proof: 'none', signals }), pack);
      expect(d.outcome).toBe(noneOutcome);
      expect(d.reasons).toEqual([...signalCodes, ...noneCodes]);
    });
  }

  it('tier ≥ 5 stays hold at tier 6 (two signals)', () => {
    const d = gate(
      request('fee.waive'),
      context({ signals: { unusual_hour: true, calls_last_hour: 3 } }),
      packWithHourWeight(4),
    );
    expect(d.tier).toBe(6);
    expect(d.outcome).toBe('hold');
    expect(d.reasons).toEqual(['S_CALL_BURST', 'S_UNUSUAL_HOUR', 'H_SPECIALIST']);
  });

  it('a tier-0 write (only possible with a hand-built pack) allows with proof and denies without', () => {
    const feeWaive = IN_PACK.actions['fee.waive'];
    if (feeWaive?.perimeter !== 'agent') throw new Error('fixture');
    const pack: CompiledPolicyPack = {
      ...IN_PACK,
      actions: { ...IN_PACK.actions, 'fee.waive': { ...feeWaive, tier: 0, limit: null } },
    };
    expect(gate(request('fee.waive'), context(), pack)).toMatchObject({
      outcome: 'allow',
      reasons: ['P_TIER0'],
    });
    expect(gate(request('fee.waive'), context({ proof: 'none' }), pack)).toMatchObject({
      outcome: 'deny',
      reasons: ['P_TIER0', 'I_NO_PROOF'],
    });
  });
});

describe('tier table — a read: balance.view, base tier 0', () => {
  const rows: [number, 'allow' | 'step_up' | 'hold', ReasonCode[]][] = [
    [0, 'allow', []],
    [1, 'allow', ['P_WITHIN_LIMIT']],
    [2, 'allow', ['P_TIER2']],
    [3, 'step_up', ['P_TIER3_STEP_UP']],
    [4, 'step_up', ['P_TIER4_HOLD_24H']],
    [5, 'hold', ['H_SPECIALIST']],
  ];
  for (const [tier, outcome, codes] of rows) {
    // Weights cap at 4, so tier 5 adds a call burst on top of a weight-4 unusual hour.
    const pack = packWithHourWeight(Math.min(tier, 4));
    const signals = {
      ...(tier > 0 ? { unusual_hour: true } : {}),
      ...(tier > 4 ? { calls_last_hour: 3 } : {}),
    };
    const signalCodes: ReasonCode[] = [
      ...(tier > 4 ? (['S_CALL_BURST'] as const) : []),
      ...(tier > 0 ? (['S_UNUSUAL_HOUR'] as const) : []),
    ];
    const readPass = { scopes: [{ action: 'balance.view' as const }], uses: {} };

    for (const proof of PROVEN) {
      it(`tier ${tier} × proof ${proof} → ${outcome}`, () => {
        const ctx =
          proof === 'pass' ? context({ proof, pass: readPass, signals }) : context({ proof, signals });
        const d = gate(request('balance.view'), ctx, pack);
        expect(d.outcome).toBe(outcome);
        expect(d.reasons).toEqual([
          'P_TIER0',
          ...signalCodes,
          ...(proof === 'pass' ? (['X_PASS_IN_SCOPE'] as const) : []),
          ...codes,
        ]);
      });
    }

    it(`clarification 2: tier ${tier} × proof none → deny I_NO_PROOF (a read never steps up)`, () => {
      const d = gate(request('balance.view'), context({ proof: 'none', signals }), pack);
      expect(d.outcome).toBe('deny');
      expect(d.reasons).toEqual(['P_TIER0', ...signalCodes, 'I_NO_PROOF']);
    });
  }
});

describe('step 1: readback', () => {
  it('denies a write the caller did not confirm', () => {
    const d = gate(request('transfer.saved', { readback_confirmed: false }));
    expect(d).toMatchObject({ outcome: 'deny', reasons: ['P_TIER2', 'R_READBACK_NOT_CONFIRMED'] });
  });

  it('does not apply to reads', () => {
    expect(gate(request('balance.view', { readback_confirmed: false })).outcome).toBe('allow');
  });

  it('comes before distress and the human-only perimeter (first match wins)', () => {
    const d = gate(request('account.close', { readback_confirmed: false }), context({ distress: true }));
    expect(d).toMatchObject({ outcome: 'deny', reasons: ['R_READBACK_NOT_CONFIRMED'] });
  });

  it('applies to protective writes too', () => {
    expect(gate(request('card.freeze', { readback_confirmed: false })).outcome).toBe('deny');
  });
});

describe('step 2: distress and the human-only perimeter', () => {
  it('holds a distressed caller with T_DISTRESS and H_SPECIALIST', () => {
    const d = gate(request('transfer.saved'), context({ distress: true }));
    expect(d).toMatchObject({ outcome: 'hold', reasons: ['P_TIER2', 'T_DISTRESS', 'H_SPECIALIST'] });
  });

  it('holds human-only actions with P_HUMAN_ONLY (no tier codes)', () => {
    const d = gate(request('account.close'));
    expect(d).toMatchObject({ outcome: 'hold', tier: null, base_tier: null });
    expect(d.reasons).toEqual(['P_HUMAN_ONLY', 'H_SPECIALIST']);
  });

  it('scenario 9: distress + human-only → hold with every applicable code', () => {
    const d = gate(request('account.close'), context({ distress: true }));
    expect(d.reasons).toEqual(['T_DISTRESS', 'P_HUMAN_ONLY', 'H_SPECIALIST']);
  });

  it('holds an amount above human_only_above_minor (US wire $8,000 > $5,000)', () => {
    const req = request('wire.new', { params: sampleParams('wire.new', 'USD', 800000), channel: 'web' });
    const d = gate(req, context({ proof: 'app_session' }), US_PACK);
    expect(d).toMatchObject({ outcome: 'hold', tier: 3, base_tier: 3 });
    expect(d.reasons).toEqual(['P_TIER3_STEP_UP', 'P_HUMAN_ONLY_ABOVE_LIMIT', 'H_SPECIALIST']);
  });

  it('does not hold an amount exactly at human_only_above_minor', () => {
    const req = request('wire.new', { params: sampleParams('wire.new', 'USD', 500000), channel: 'web' });
    expect(gate(req, context({ proof: 'app_session' }), US_PACK).outcome).toBe('step_up');
  });

  it('collects distress and the above-limit code together', () => {
    const req = request('wire.new', { params: sampleParams('wire.new', 'USD', 800000), channel: 'web' });
    const d = gate(req, context({ proof: 'app_session', distress: true }), US_PACK);
    expect(d.reasons).toEqual(['P_TIER3_STEP_UP', 'T_DISTRESS', 'P_HUMAN_ONLY_ABOVE_LIMIT', 'H_SPECIALIST']);
  });

  it('clarification 6: distress comes before protective, so a distressed card freeze is held', () => {
    const d = gate(request('card.freeze'), context({ distress: true }));
    expect(d).toMatchObject({ outcome: 'hold', reasons: ['P_TIER0', 'T_DISTRESS', 'H_SPECIALIST'] });
  });
});

describe('step 3: coaching → hold, never step-up', () => {
  it('holds a money-moving action at or above the threshold', () => {
    for (const score of [0.6, 0.7, 1]) {
      const d = gate(request('transfer.new_payee'), context({ coaching: { score, cues: ['safe_account'] } }));
      expect(d).toMatchObject({
        outcome: 'hold',
        reasons: ['P_TIER3_STEP_UP', 'S_COACHING', 'H_SPECIALIST'],
      });
    }
  });

  it('does not hold below the threshold', () => {
    expect(gate(request('transfer.new_payee'), context({ coaching: { score: 0.59 } })).outcome).toBe(
      'step_up',
    );
  });

  it('applies only to money-moving actions', () => {
    expect(gate(request('fee.waive'), context({ coaching: { score: 0.9 } })).outcome).toBe('allow');
  });

  it('beats proof: a valid registered caller is still held', () => {
    const d = gate(request('transfer.saved'), context({ coaching: { score: 0.8 } }));
    expect(d.outcome).toBe('hold');
  });
});

describe('step 4: protective actions', () => {
  it('allows a card freeze with any proof, even no customer and an unknown number', () => {
    const req = request('card.freeze', {
      customer_id: null,
      caller: { from_number: UNREGISTERED, kind: 'unknown' },
    });
    const d = gate(req, context({ proof: 'none', signals: { unregistered_number: true } }));
    expect(d).toMatchObject({ outcome: 'allow', tier: 1, base_tier: 0 });
    expect(d.reasons).toEqual(['P_TIER0', 'S_UNREGISTERED_NUMBER', 'P_PROTECTIVE']);
  });
});

describe('step 5: proof', () => {
  it('denies a read when no customer is identified', () => {
    const d = gate(request('balance.view', { customer_id: null }), context({ proof: 'none' }));
    expect(d).toMatchObject({ outcome: 'deny', reasons: ['P_TIER0', 'I_NO_PROOF'] });
  });

  it('denies a write when no customer is identified (no one to confirm a step-up)', () => {
    const d = gate(request('transfer.new_payee', { customer_id: null }), context({ proof: 'none' }));
    expect(d).toMatchObject({ outcome: 'deny', reasons: ['P_TIER3_STEP_UP', 'I_NO_PROOF'] });
  });

  it('a Pass in scope is proof (X_PASS_IN_SCOPE)', () => {
    const d = gate(request('emi.move_date'), context({ proof: 'pass', pass: PASS }));
    expect(d).toMatchObject({ outcome: 'allow', proof: 'pass', reasons: ['P_TIER2', 'X_PASS_IN_SCOPE'] });
  });

  it('an action outside the Pass is treated as no proof (X_PASS_OUT_OF_SCOPE)', () => {
    const d = gate(request('transfer.new_payee'), context({ proof: 'pass', pass: PASS }));
    expect(d).toMatchObject({ outcome: 'step_up', proof: 'none' });
    expect(d.reasons).toEqual(['P_TIER3_STEP_UP', 'X_PASS_OUT_OF_SCOPE', 'I_NO_PROOF']);
  });
});

describe('clarification 7: a Pass is in scope only when all three hold', () => {
  it('no uses left → out of scope', () => {
    const pass = { ...PASS, uses: { 'emi.move_date': 1 } };
    const d = gate(request('emi.move_date'), context({ proof: 'pass', pass }));
    expect(d).toMatchObject({ outcome: 'step_up', proof: 'none' });
    expect(d.reasons).toContain('X_PASS_OUT_OF_SCOPE');
  });

  it('max_uses absent → no cap', () => {
    const pass = { ...PASS, uses: { 'fee.waive': 50 } };
    expect(gate(request('fee.waive'), context({ proof: 'pass', pass })).proof).toBe('pass');
  });

  it('the pack no longer marks the action pass_eligible → out of scope', () => {
    const pack = inPackWith((p) => void (p.actions['emi.move_date'] = { tier: 2, pass_eligible: false }));
    const d = gate(request('emi.move_date'), context({ proof: 'pass', pass: PASS }), pack);
    expect(d.proof).toBe('none');
    expect(d.reasons).toContain('X_PASS_OUT_OF_SCOPE');
  });

  it('a Pass scope naming a human-only action never grants proof', () => {
    const pass = { scopes: [{ action: 'account.close' as const }], uses: {} };
    const d = gate(request('account.close'), context({ proof: 'pass', pass }));
    expect(d.outcome).toBe('hold');
    expect(d.reasons).toEqual(['X_PASS_OUT_OF_SCOPE', 'P_HUMAN_ONLY', 'H_SPECIALIST']);
  });
});

describe('step 6 + clarification 5: signals', () => {
  it.each<[string, ContextOverrides, ReasonCode]>([
    ['unregistered number', { signals: { unregistered_number: true } }, 'S_UNREGISTERED_NUMBER'],
    ['3 calls in the last hour', { signals: { calls_last_hour: 3 } }, 'S_CALL_BURST'],
    ['unusual hour', { signals: { unusual_hour: true } }, 'S_UNUSUAL_HOUR'],
    ['liveness 0.29', { signals: { liveness: 0.29 } }, 'S_LOW_LIVENESS'],
    ['2 transfers in 10 minutes', { counters: { transfers_last_10m: 2 } }, 'S_VELOCITY'],
  ])('%s raises the tier by its weight and reports %s', (_, overrides, code) => {
    const d = gate(request('transfer.saved'), context(overrides));
    expect(d).toMatchObject({ tier: 3, base_tier: 2, outcome: 'step_up', signals: [code] });
    expect(d.reasons).toEqual(['P_TIER2', code, 'P_TIER3_STEP_UP']);
  });

  it.each<[string, ContextOverrides]>([
    ['2 calls in the last hour', { signals: { calls_last_hour: 2 } }],
    ['liveness exactly 0.3', { signals: { liveness: 0.3 } }],
    ['no liveness score', { signals: {} }],
    ['1 transfer in 10 minutes', { counters: { transfers_last_10m: 1 } }],
  ])('%s does not fire', (_, overrides) => {
    const d = gate(request('transfer.saved'), context(overrides));
    expect(d).toMatchObject({ tier: 2, signals: [], outcome: 'allow' });
  });

  it('reports every signal in a fixed order', () => {
    const d = gate(
      request('balance.view'),
      context({
        signals: { unregistered_number: true, calls_last_hour: 5, unusual_hour: true, liveness: 0.1 },
        counters: { transfers_last_10m: 4 },
      }),
    );
    expect(d.signals).toEqual([
      'S_UNREGISTERED_NUMBER',
      'S_CALL_BURST',
      'S_UNUSUAL_HOUR',
      'S_LOW_LIVENESS',
      'S_VELOCITY',
    ]);
    expect(d.tier).toBe(5);
  });

  it('a signal weighted 0 is reported but does not raise the tier', () => {
    const pack = packWithHourWeight(0);
    const d = gate(request('transfer.saved'), context({ signals: { unusual_hour: true } }), pack);
    expect(d).toMatchObject({ tier: 2, outcome: 'allow', reasons: ['P_TIER2', 'S_UNUSUAL_HOUR'] });
  });

  it('weights come from the pack', () => {
    const pack = inPackWith((p) => void (p.signals.unregistered_number = 3));
    const d = gate(request('transfer.saved'), context({ signals: { unregistered_number: true } }), pack);
    expect(d).toMatchObject({ tier: 5, outcome: 'hold' });
  });

  it('unregistered_number is ignored for app_session proof and for web calls', () => {
    const onApp = gate(
      request('transfer.saved'),
      context({ proof: 'app_session', signals: { unregistered_number: true } }),
    );
    const onWeb = gate(
      request('transfer.saved', { channel: 'web' }),
      context({ signals: { unregistered_number: true } }),
    );
    for (const d of [onApp, onWeb]) expect(d).toMatchObject({ tier: 2, signals: [], outcome: 'allow' });
  });
});

describe('step 7 + clarification 8: limits', () => {
  const used = (count: number, amount_minor: number) => ({
    counters: { per_action_period: { 'transfer.saved': { count, amount_minor } } },
  });

  it('within the amount limit (used + amount = limit) → allow', () => {
    const req = request('transfer.saved', { params: sampleParams('transfer.saved', 'INR', 400000) });
    expect(gate(req, context(used(1, 600000))).outcome).toBe('allow');
  });

  it('one paisa over the amount limit → step_up with P_OVER_LIMIT', () => {
    const req = request('transfer.saved', { params: sampleParams('transfer.saved', 'INR', 400001) });
    const d = gate(req, context(used(1, 600000)));
    expect(d.outcome).toBe('step_up');
    expect(d.reasons).toEqual(['P_TIER2', 'P_OVER_LIMIT']);
  });

  it('over the count limit → step_up', () => {
    const counters = { per_action_period: { 'fee.waive': { count: 1, amount_minor: 0 } } };
    const d = gate(request('fee.waive'), context({ counters }));
    expect(d).toMatchObject({ outcome: 'step_up', reasons: ['P_OVER_LIMIT'] });
  });

  it('clarification 4: P_WITHIN_LIMIT is left out when the limit is exceeded', () => {
    const req = request('fee.waive', { params: sampleParams('fee.waive', 'INR', 100001) });
    expect(gate(req).reasons).toEqual(['P_OVER_LIMIT']);
  });

  it('over the limit never loosens an outcome that is already stricter', () => {
    const req = request('transfer.new_payee', { params: sampleParams('transfer.new_payee', 'INR', 10) });
    const counters = { per_action_period: { 'transfer.new_payee': { count: 99, amount_minor: 0 } } };
    expect(gate(req, context({ counters })).outcome).toBe('step_up');
  });

  it('an action without a limit is never over one', () => {
    const counters = { per_action_period: { 'transfer.new_payee': { count: 1000, amount_minor: 10 ** 12 } } };
    expect(gate(request('transfer.new_payee'), context({ counters })).reasons).not.toContain('P_OVER_LIMIT');
  });

  it('missing counters count as nothing used', () => {
    expect(gate(request('fee.waive'), context()).outcome).toBe('allow');
  });
});

describe('clarification 1 + step 9: fail closed', () => {
  it.each<[string, () => ReturnType<typeof gate>]>([
    [
      'an action the region does not offer (wire.new in IN)',
      () => gate(request('wire.new', { params: sampleParams('wire.new') })),
    ],
    [
      'params that fail the schema',
      () => gate(request('transfer.saved', { params: { amount_minor: 100, currency: 'INR' } })),
    ],
    ['an extra param', () => gate(request('card.freeze', { params: { card_last4: '8812', note: 'x' } }))],
    [
      'an amount in the wrong currency',
      () => gate(request('transfer.saved', { params: sampleParams('transfer.saved', 'USD') })),
    ],
    ['an unknown action', () => gate({ ...request(), action: 'card.melt' } as unknown as ProposeRequest)],
    ['a malformed request', () => gate({ action: 'card.freeze' } as unknown as ProposeRequest)],
    [
      'too many caller quotes',
      () => gate(request('card.freeze', { caller_quotes: ['a', 'b', 'c', 'd', 'e', 'f'] })),
    ],
    ['a coaching score above 1', () => gate(request(), context({ coaching: { score: 1.5 } }))],
    ['proof "pass" without a Pass', () => gate(request(), context({ proof: 'pass' }))],
    ['a Pass without proof "pass"', () => gate(request(), { ...context(), pass: PASS })],
    ['negative counters', () => gate(request(), context({ counters: { transfers_last_10m: -1 } }))],
  ])('%s → deny E_FAIL_CLOSED only', (_, run) => {
    const d = run();
    expect(d).toMatchObject({
      outcome: 'deny',
      tier: null,
      base_tier: null,
      reasons: FAIL_CLOSED,
      confirm: null,
    });
  });

  it('a thrown error anywhere → deny E_FAIL_CLOSED', () => {
    const broken = { ...IN_PACK } as CompiledPolicyPack;
    Object.defineProperty(broken, 'actions', {
      get() {
        throw new Error('KV read failed');
      },
    });
    expect(gate(request(), context(), broken)).toMatchObject({ outcome: 'deny', reasons: FAIL_CLOSED });
  });

  it('keeps the action on the fail-closed decision when the request parsed', () => {
    expect(gate(request('wire.new', { params: sampleParams('wire.new') })).action).toBe('wire.new');
    expect(gate({ nope: true } as unknown as ProposeRequest).action).toBeNull();
  });
});

describe('clarification 3: every hold includes H_SPECIALIST', () => {
  it.each<[string, () => ReturnType<typeof gate>]>([
    ['distress', () => gate(request(), context({ distress: true }))],
    ['human-only', () => gate(request('loan.new', { params: sampleParams('loan.new') }))],
    ['coaching', () => gate(request('transfer.saved'), context({ coaching: { score: 0.9 } }))],
    [
      'tier ≥ 5',
      () =>
        gate(
          request('transfer.saved'),
          context({ signals: { unusual_hour: true, calls_last_hour: 3, unregistered_number: true } }),
        ),
    ],
  ])('%s', (_, run) => {
    const d = run();
    expect(d.outcome).toBe('hold');
    expect(d.reasons).toContain('H_SPECIALIST');
  });
});

describe('clarification 4: reason codes', () => {
  it.each<[number, ReasonCode | undefined]>([
    [0, 'P_TIER0'],
    [2, 'P_TIER2'],
    [3, 'P_TIER3_STEP_UP'],
    [4, 'P_TIER4_HOLD_24H'],
  ])('base tier %i leads with %s', (tier, code) => {
    const action = {
      0: 'statement.view',
      2: 'emi.move_date',
      3: 'card.reset_pin',
      4: 'profile.change_email',
    }[tier];
    const d = gate(request(action as ProposeRequest['action']));
    expect(d.base_tier).toBe(tier);
    expect(d.reasons[0]).toBe(code);
  });

  it('a tier-1 action has no base code', () => {
    expect(gate(request('fee.waive')).reasons).toEqual(['P_WITHIN_LIMIT']);
  });

  it('order is base tier, signals, Pass, then rule codes; each code once', () => {
    const d = gate(
      request('statement.view'),
      context({ proof: 'pass', pass: PASS, signals: { unusual_hour: true, calls_last_hour: 3 } }),
    );
    expect(d.reasons).toEqual(['P_TIER0', 'S_CALL_BURST', 'S_UNUSUAL_HOUR', 'X_PASS_IN_SCOPE', 'P_TIER2']);
    expect(new Set(gate(request('statement.view')).reasons).size).toBe(
      gate(request('statement.view')).reasons.length,
    );
  });

  it('scenario 3: base 3 + one signal → tier-4 row code, and I_NO_PROOF without proof', () => {
    const req = request('transfer.new_payee', { caller: { from_number: UNREGISTERED, kind: 'human' } });
    const d = gate(req, context({ proof: 'none', signals: { unregistered_number: true } }));
    expect(d).toMatchObject({ outcome: 'step_up', tier: 4 });
    expect(d.reasons).toEqual(['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER', 'P_TIER4_HOLD_24H', 'I_NO_PROOF']);
  });

  it('earlier rules add only their own code (no tier-row code)', () => {
    expect(gate(request('statement.view'), context({ distress: true })).reasons).toEqual([
      'P_TIER0',
      'T_DISTRESS',
      'H_SPECIALIST',
    ]);
  });
});

describe('decision shape', () => {
  it('carries the confirmation channels only on step_up', () => {
    const stepUp = gate(request('transfer.new_payee'));
    expect(stepUp.confirm).toEqual({ channels: ['passkey', 'callback'], timeout_seconds: 60 });
    expect(gate(request('fee.waive')).confirm).toBeNull();
  });

  it('uses the US pack channels (passkey only, no callback to US numbers)', () => {
    const req = request('wire.new', { params: sampleParams('wire.new', 'USD', 100000), channel: 'web' });
    expect(gate(req, context({ proof: 'app_session' }), US_PACK).confirm?.channels).toEqual(['passkey']);
  });

  it('reports the amount and the effective proof', () => {
    const d = gate(request('transfer.saved'));
    expect(d.amount).toEqual({ amount_minor: 60000, currency: 'INR' });
    expect(d.proof).toBe('registered_number');
    expect(gate(request('card.freeze')).amount).toBeNull();
  });

  it('is deterministic', () => {
    const req = request('transfer.new_payee');
    const ctx = context({ signals: { unusual_hour: true } });
    expect(gate(req, ctx)).toEqual(gate(req, ctx));
  });

  it('does not mutate its inputs', () => {
    const req = request('emi.move_date');
    const ctx = context({ proof: 'pass', pass: PASS });
    const before = JSON.stringify([req, ctx, IN_PACK]);
    gate(req, ctx);
    expect(JSON.stringify([req, ctx, IN_PACK])).toBe(before);
  });
});

describe('toDecision', () => {
  it('produces a shared Decision for every outcome', () => {
    const decisions = [
      gate(request('card.freeze')),
      gate(request('transfer.new_payee')),
      gate(request('account.close')),
      gate(request('transfer.saved', { readback_confirmed: false })),
      gate({ broken: true } as unknown as ProposeRequest),
    ];
    for (const d of decisions) {
      const parsed = DecisionSchema.safeParse(toDecision(d, 'req_01JABCDEFGHJKMNPQRSTVWXYZ0'));
      expect(parsed.success, JSON.stringify(d)).toBe(true);
    }
  });

  it('adds the final outcome and its codes after a step-up', () => {
    const d = gate(request('transfer.new_payee'));
    const decision = toDecision(d, 'req_01JABCDEFGHJKMNPQRSTVWXYZ0', {
      final_outcome: 'deny',
      reasons: ['C_DECLINED'],
      execute_at: null,
    });
    expect(decision).toMatchObject({ outcome: 'step_up', final_outcome: 'deny' });
    expect(decision.reasons).toEqual(['P_TIER3_STEP_UP', 'C_DECLINED']);
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
  });
});

describe('escalateForCoaching (coaching layer 2, ADR-024)', () => {
  const money = request('transfer.new_payee');

  it('turns a money step_up into the step-3 hold, keeping tier, signal and Pass codes', () => {
    const first = gate(money, context({ proof: 'none' }));
    expect(first.outcome).toBe('step_up');
    const held = escalateForCoaching(first, 0.9, IN_PACK);
    expect(held).toMatchObject({ outcome: 'hold', confirm: null, tier: first.tier });
    expect(held?.reasons).toEqual(expect.arrayContaining(['S_COACHING', 'H_SPECIALIST']));
  });

  it('leaves a score below the threshold, a non-money action and an unread action alone', () => {
    const first = gate(money, context({ proof: 'none' }));
    expect(escalateForCoaching(first, 0.59, IN_PACK)).toBeNull();
    expect(escalateForCoaching(gate(request('card.freeze'), context()), 1, IN_PACK)).toBeNull();
    expect(escalateForCoaching({ ...first, action: null }, 1, IN_PACK)).toBeNull();
  });
});
