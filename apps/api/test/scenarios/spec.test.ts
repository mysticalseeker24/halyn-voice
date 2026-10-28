import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import specText from '../../../../tests/scenarios/scenarios.yaml?raw';
import specJson from '../../../../tests/scenarios/scenarios.json';
import { bundledSpec, ScenarioSpecSchema } from '../../src/test-runner/spec';

// The acceptance spec: tests/scenarios/scenarios.yaml is the source; scenarios.json is its committed twin, which the
// Worker bundles (no YAML at runtime). They must never differ.
describe('acceptance spec (tests/scenarios/scenarios.yaml)', () => {
  it('lists scenarios 1–12 plus 3b, and parses with the runner schema', () => {
    const spec = ScenarioSpecSchema.parse(parse(specText));
    expect(spec.scenarios.map((s) => s.id).join(' ')).toBe('1 2 3 3b 4 5 6 7 8 9 10 11 12');
    for (const s of spec.scenarios) expect(s.title).toBeTruthy();
  });

  it('scenarios.json is exactly scenarios.yaml (regenerate the JSON when the YAML changes)', () => {
    const { _generated_from: _, ...json } = specJson as Record<string, unknown>;
    expect(json).toEqual(parse(specText));
    expect(bundledSpec()).toEqual(ScenarioSpecSchema.parse(parse(specText)));
  });
});
