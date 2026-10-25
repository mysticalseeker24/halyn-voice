import { describe, expect, it } from 'vitest';
import {
  compilePolicyPack,
  isReasonCode,
  OUTCOMES,
  packAction,
  parseActionParams,
  type PolicyPack,
  ProposeActionRequestSchema,
  validatePolicyPack,
} from '../src/index';
import { readRepoYaml } from './repo';

interface Propose {
  action: string;
  params: unknown;
  readback_confirmed: boolean;
  caller_quotes?: string[];
}
interface Expect {
  decision?: string;
  final?: string;
  reasons_include?: string[];
}
interface Scenario {
  id: number | string;
  region: 'IN' | 'US';
  steps: { propose?: Propose; expect?: Expect }[];
  compare_in_region?: 'IN' | 'US';
  compare_step?: { propose: Propose; expect?: Expect };
  expect_sequence?: Expect[];
}

const spec = readRepoYaml('tests/scenarios/scenarios.yaml') as { scenarios: Scenario[] };

const proposals = spec.scenarios.flatMap((s) => [
  ...s.steps.flatMap((step, i) =>
    step.propose ? [{ label: `${s.id}.${i + 1}`, region: s.region, propose: step.propose }] : [],
  ),
  ...(s.compare_step
    ? [{ label: `${s.id} compare`, region: s.compare_in_region ?? s.region, propose: s.compare_step.propose }]
    : []),
]);

const expectations = spec.scenarios.flatMap((s) => [
  ...s.steps.flatMap((step) => (step.expect ? [step.expect] : [])),
  ...(s.compare_step?.expect ? [s.compare_step.expect] : []),
  ...(s.expect_sequence ?? []),
]);

function pack(file: string): PolicyPack {
  const result = validatePolicyPack(readRepoYaml(`policy-packs/${file}`));
  if (!result.ok) throw new Error(result.error);
  return result.pack;
}
const packs = {
  IN: compilePolicyPack(pack('aero-in.yaml'), '0'.repeat(64)),
  US: compilePolicyPack(pack('aero-us.yaml'), '0'.repeat(64)),
};

describe('tests/scenarios/scenarios.yaml', () => {
  it('has a proposal for every scenario that proposes', () => {
    expect(proposals.length).toBeGreaterThanOrEqual(13);
  });

  it.each(proposals.map((p) => [p.label, p] as const))(
    'scenario %s: params match the action schema',
    (_, p) => {
      const parsed = parseActionParams(p.propose.action, p.propose.params);
      expect(parsed.ok ? 'ok' : parsed.error).toBe('ok');
    },
  );

  it.each(proposals.map((p) => [p.label, p] as const))(
    'scenario %s: the action is in its region pack',
    (_, p) => {
      expect(packAction(packs[p.region], p.propose.action as never)).toBeDefined();
    },
  );

  it.each(proposals.map((p) => [p.label, p] as const))(
    'scenario %s: is a valid propose_action tool call',
    (_, p) => {
      const request = {
        run_id: `scenario-${p.label}`,
        channel: p.region === 'US' ? 'web' : 'phone',
        action: p.propose.action,
        params: p.propose.params,
        readback_confirmed: p.propose.readback_confirmed,
        caller_quotes: p.propose.caller_quotes ?? [],
      };
      const parsed = ProposeActionRequestSchema.parse(request);
      expect(parsed.caller_quotes).toEqual(request.caller_quotes);
    },
  );

  it('expects only known reason codes and outcomes', () => {
    const codes = expectations.flatMap((e) => e.reasons_include ?? []);
    expect(codes.length).toBeGreaterThan(10);
    expect(codes.filter((c) => !isReasonCode(c))).toEqual([]);
    const outcomes = expectations.flatMap((e) => [e.decision, e.final].filter((o) => o !== undefined));
    expect(outcomes.filter((o) => !(OUTCOMES as readonly string[]).includes(o))).toEqual([]);
  });
});
