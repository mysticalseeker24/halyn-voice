import { afterAll, describe, expect, it } from 'vitest';
import { runScenario, type ScenarioResult } from '../../src/test-runner/runner';
import { bundledSpec } from '../../src/test-runner/spec';
import { scenarioHarness } from './harness';

// `pnpm test:scenarios` — every scenario of tests/scenarios/scenarios.yaml through the real tools, Gate, Pass, Hub,
// ledger and Aero Core (Miniflare), with Bolna and the customer's answers simulated (docs/SCENARIOS.md). Scenarios
// that need a later step are listed explicitly as pending with that step, never silently skipped.

const PENDING: Record<string, string> = {
  // A browser call carries the customer's app session (proof app_session, channel web) and the Stage switches the
  // region: the API mints Bolna web-call sessions and registers the call in Step 12.
  '10': 'Step 12: browser calls and the region switch',
};

const spec = bundledSpec();
const results: ScenarioResult[] = [];

describe('scenarios (text mode, real Halyn)', () => {
  for (const scenario of spec.scenarios) {
    const pending = PENDING[scenario.id];
    const title = `scenario ${scenario.id}: ${scenario.title}`;
    if (pending) {
      it.skip(`${title} — pending (${pending})`, () => undefined);
      continue;
    }
    it(title, async () => {
      const harness = await scenarioHarness();
      try {
        const result = await runScenario(spec, scenario, harness);
        results.push(result);
        expect(result.failures, JSON.stringify(result.steps, null, 1)).toEqual([]);
      } finally {
        harness.close();
      }
    });
  }

  afterAll(() => {
    const ms = results.flatMap((r) => r.propose_ms).sort((a, b) => a - b);
    const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0;
    console.info(
      `propose_action over ${ms.length} calls: median ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${ms.at(-1) ?? 0} ms`,
    );
    for (const r of results)
      console.info(
        `scenario ${r.id}: ${r.passed ? 'PASS' : 'FAIL'}${r.skipped.length ? ` (skipped: ${r.skipped.join('; ')})` : ''}`,
      );
  });
});
