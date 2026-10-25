import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import specText from '../../../../tests/scenarios/scenarios.yaml?raw';

interface ScenarioSpec {
  version: number;
  scenarios: { id: number | string; title: string }[];
}

// Placeholder for the text-mode scenario runner (PROMPTS.md Step 7): the acceptance spec parses and
// lists every scenario. The runner will execute each one through the real Gate, Pass, Ledger and Aero Core.
describe('acceptance spec (tests/scenarios/scenarios.yaml)', () => {
  it('lists scenarios 1–12 plus 3b', () => {
    const spec = parse(specText) as ScenarioSpec;
    expect(spec.version).toBe(1);
    expect(spec.scenarios.map((s) => s.id).join(' ')).toBe('1 2 3 3b 4 5 6 7 8 9 10 11 12');
    for (const s of spec.scenarios) expect(s.title).toBeTruthy();
  });
});
