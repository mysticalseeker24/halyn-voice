import {
  type ActionId,
  type CompiledPolicyPack,
  eventForOutcome,
  type Outcome,
  type ReasonCode,
} from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import specText from '../../../../tests/scenarios/scenarios.yaml?raw';
import { CLOCK, IN_PACK, PASS, REGISTERED, US_PACK } from '../../test/fixtures/gate';
import { scoreCoaching } from '../signals/coaching-lexicon';
import { detectDistress } from '../signals/distress-lexicon';
import {
  decide,
  type GateContext,
  type GateDecision,
  type ProposeRequest,
  resolveStepUp,
  type StepUpAnswer,
  type StepUpResolution,
} from './index';

// Gate-level acceptance: every scenario in tests/scenarios/scenarios.yaml through the real Gate, lexicons and
// post-approval rules. The full runner (Step 7) adds Confirm, the Hub, the ledger and Aero Core on top.

interface Propose {
  action: ActionId;
  params: Record<string, unknown>;
  readback_confirmed: boolean;
  caller_quotes?: string[];
}
interface Expect {
  decision?: Outcome;
  final?: 'allow' | 'hold' | 'deny';
  reasons_include?: ReasonCode[];
  core_called?: boolean;
  events?: string[];
  confirmation_channels?: string[];
  step_up_offered?: boolean;
  handoff_created?: boolean;
}
interface Step {
  propose?: Propose;
  confirm_answer?: { channel: 'passkey' | 'callback' | 'none'; answer?: 'approve' | 'decline' };
  expect?: Expect;
  verify_pass?: unknown;
  direct_core_call?: unknown;
}
interface Scenario {
  id: number | string;
  title: string;
  region: 'IN' | 'US';
  caller: { from: string; kind: ProposeRequest['caller']['kind']; pass?: string };
  steps: Step[];
  repeat?: number;
  expect_sequence?: {
    index?: number;
    from_index?: number;
    decision: Outcome;
    reasons_include?: ReasonCode[];
  }[];
  compare_in_region?: 'IN' | 'US';
  compare_step?: Step;
}
interface Spec {
  numbers: Record<string, string>;
  scenarios: Scenario[];
}

const spec = parse(specText) as Spec;
const PACKS: Record<'IN' | 'US', CompiledPolicyPack> = { IN: IN_PACK, US: US_PACK };

/** Per-scenario state the caller would supply: counters and Pass uses grow as actions are allowed. */
class Call {
  private readonly uses: Partial<Record<ActionId, number>> = {};
  private readonly perPeriod: Partial<Record<ActionId, { count: number; amount_minor: number }>> = {};
  private transfers = 0;

  constructor(private readonly scenario: Scenario) {}

  propose(p: Propose, region: 'IN' | 'US') {
    const { from, kind, pass } = this.scenario.caller;
    const quotes = p.caller_quotes ?? [];
    const coaching = scoreCoaching(quotes);
    const viaPass = from === 'assistant' && pass === 'valid_view_freeze_emi';
    const customer = from === 'unknown_ai' ? null : region === 'US' ? 'cus_saksham_us' : 'cus_saksham';
    const req: ProposeRequest = {
      tenant_id: 'ten_aero',
      run_id: `run_scenario_${String(this.scenario.id)}`,
      channel: from === 'app_session' ? 'web' : 'phone',
      caller: {
        ...(from === 'app_session' ? { app_session_customer_id: customer ?? undefined } : {}),
        ...(from === 'app_session'
          ? {}
          : { from_number: from === 'registered' ? REGISTERED : spec.numbers[from] }),
        kind,
      },
      customer_id: customer,
      action: p.action,
      params: p.params,
      readback_confirmed: p.readback_confirmed,
      caller_quotes: quotes,
    };
    const proof: GateContext['proof'] =
      from === 'registered'
        ? 'registered_number'
        : from === 'app_session'
          ? 'app_session'
          : viaPass
            ? 'pass'
            : 'none';
    const ctx: GateContext = {
      proof,
      ...(viaPass
        ? { pass: { scopes: PASS.scopes.filter((s) => s.action !== 'fee.waive'), uses: { ...this.uses } } }
        : {}),
      counters: { per_action_period: { ...this.perPeriod }, transfers_last_10m: this.transfers },
      // The clone's second phone matches neither the registered number nor a Pass number.
      signals: { unregistered_number: from === 'unregistered', calls_last_hour: 0, unusual_hour: false },
      coaching: { score: coaching.score, cues: coaching.cues },
      distress: detectDistress(quotes).distress,
    };
    const decision = decide(req, ctx, PACKS[region], CLOCK);
    if (decision.outcome === 'allow') this.record(decision);
    return decision;
  }

  private record(d: GateDecision) {
    if (!d.action) return;
    if (d.proof === 'pass') this.uses[d.action] = (this.uses[d.action] ?? 0) + 1;
    const used = this.perPeriod[d.action] ?? { count: 0, amount_minor: 0 };
    this.perPeriod[d.action] = {
      count: used.count + 1,
      amount_minor: used.amount_minor + (d.amount?.amount_minor ?? 0),
    };
    if (d.action.startsWith('transfer.') || d.action.startsWith('wire.')) this.transfers += 1;
  }
}

function answerOf(step: Step): StepUpAnswer | null {
  const a = step.confirm_answer;
  if (!a) return null;
  if (a.channel === 'none') return 'timeout';
  return a.answer === 'approve' ? 'approved' : 'declined';
}

const FINAL_EVENT = { declined: 'denied', timeout: 'timeout' } as const;

function check(id: string, step: Step, d: GateDecision, pack: CompiledPolicyPack) {
  const e = step.expect ?? {};
  const answer = answerOf(step);
  const resolution: StepUpResolution | null = answer ? resolveStepUp(d, answer, pack, CLOCK) : null;
  const effective = resolution?.final_outcome ?? d.outcome;
  const all = new Set([...d.reasons, ...(resolution?.reasons ?? [])]);
  const at = `scenario ${id}`;

  if (e.decision) expect(d.outcome, `${at}: decision (reasons ${d.reasons.join(', ')})`).toBe(e.decision);
  if (e.final) expect(resolution?.final_outcome, `${at}: final outcome`).toBe(e.final);
  for (const code of e.reasons_include ?? [])
    expect(all.has(code), `${at}: reasons include ${code} (got ${[...all].join(', ')})`).toBe(true);
  if (e.confirmation_channels)
    expect(d.confirm?.channels, `${at}: confirmation channels`).toEqual(e.confirmation_channels);
  if (e.step_up_offered === false) expect(d.outcome, `${at}: no step-up offered`).not.toBe('step_up');
  if (e.handoff_created) {
    expect(effective, `${at}: a handoff means hold`).toBe('hold');
    expect(all.has('H_SPECIALIST'), `${at}: handoff → H_SPECIALIST`).toBe(true);
  }
  if (e.core_called !== undefined)
    expect(effective === 'allow', `${at}: Aero Core is called only on allow`).toBe(e.core_called);
  if (e.events) {
    // An allow is heard only as the bank's answer, `done` (chat #8 finding 7).
    expect(e.events[0], `${at}: first event`).toBe(d.outcome === 'allow' ? 'done' : eventForOutcome(d.outcome));
    if (answer && answer !== 'approved') expect(e.events[1], `${at}: final event`).toBe(FINAL_EVENT[answer]);
  }
}

describe('scenarios.yaml — Gate-level assertions', () => {
  it('covers all 13 scenarios (1–12 and 3b)', () => {
    expect(spec.scenarios.map((s) => String(s.id))).toEqual([
      '1',
      '2',
      '3',
      '3b',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
  });

  for (const scenario of spec.scenarios) {
    const id = String(scenario.id);
    it(`scenario ${id}: ${scenario.title}`, () => {
      const call = new Call(scenario);
      const pack = PACKS[scenario.region];
      let checked = 0;

      if (scenario.repeat && scenario.expect_sequence) {
        const step = scenario.steps[0];
        if (!step?.propose) throw new Error(`scenario ${id}: repeat needs one propose step`);
        const outcomes = Array.from({ length: scenario.repeat }, () =>
          call.propose(step.propose!, scenario.region),
        );
        for (const rule of scenario.expect_sequence) {
          const indexes = rule.index
            ? [rule.index]
            : Array.from(
                { length: scenario.repeat - (rule.from_index ?? 1) + 1 },
                (_, i) => (rule.from_index ?? 1) + i,
              );
          for (const index of indexes) {
            const d = outcomes[index - 1]!;
            expect(d.outcome, `scenario ${id} #${index}: decision (reasons ${d.reasons.join(', ')})`).toBe(
              rule.decision,
            );
            for (const code of rule.reasons_include ?? [])
              expect(d.reasons, `scenario ${id} #${index}: reasons`).toContain(code);
            checked++;
          }
        }
      }

      for (const step of scenario.repeat ? [] : scenario.steps) {
        // Not Gate behaviour: Pass code verification is Step 3 (src/pass) + Step 7 (runner); a direct Aero Core
        // call without a grant is Step 6 (apps/aero-core 401 E_GRANT_MISSING).
        if (step.verify_pass || step.direct_core_call) continue;
        if (!step.propose) throw new Error(`scenario ${id}: unknown step ${JSON.stringify(step)}`);
        check(id, step, call.propose(step.propose, scenario.region), pack);
        checked++;
      }

      if (scenario.compare_step?.propose && scenario.compare_in_region) {
        const compare = new Call(scenario);
        const region = scenario.compare_in_region;
        check(
          `${id} (compare in ${region})`,
          scenario.compare_step,
          compare.propose(scenario.compare_step.propose, region),
          PACKS[region],
        );
        checked++;
      }

      expect(checked, `scenario ${id}: at least one Gate assertion`).toBeGreaterThan(0);
    });
  }
});
