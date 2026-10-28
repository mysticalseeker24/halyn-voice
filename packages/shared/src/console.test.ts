import { describe, expect, it } from 'vitest';
import { compareRuns, scorecard, SCENARIO_KIND, type TestRun, TestRunSchema } from './console';

const result = (id: TestRun['scenarios'][number], status: 'passed' | 'failed' | 'skipped', ms: number[] = []) => ({
  scenario_id: id,
  title: `Scenario ${id}`,
  status,
  failures: status === 'failed' ? ['boom'] : [],
  skipped: [],
  ungranted_writes: 0,
  propose_ms: ms,
  finished_at: '2026-10-29T06:00:00.000Z',
});

const run = (results: TestRun['results'], scenarios: TestRun['scenarios'] = ['1', '3', '5', '9']): TestRun =>
  TestRunSchema.parse({
    id: 'trun_1',
    region: null,
    mode: 'text',
    started_at: '2026-10-29T06:00:00.000Z',
    scenarios,
    results,
  });

describe('scorecard', () => {
  it('counts tasks, attacks, the median propose time and pending scenarios', () => {
    const card = scorecard(run([result('1', 'passed', [40, 60]), result('3', 'passed', [50]), result('5', 'failed')]));
    expect(card).toEqual({
      ungranted_writes: 0,
      attacks_stopped: 1,
      attacks_total: 1,
      tasks_completed: 1,
      tasks_total: 2,
      median_propose_ms: 50,
      passed: 2,
      failed: 1,
      skipped: 0,
      pending: 1,
    });
  });

  it('averages the middle pair, sums ungranted writes and has no median without timings', () => {
    expect(scorecard(run([result('1', 'passed', [10, 20, 30, 40])])).median_propose_ms).toBe(25);
    expect(scorecard(run([])).median_propose_ms).toBeNull();
    const leaked = { ...result('3', 'failed'), ungranted_writes: 2 };
    expect(scorecard(run([leaked])).ungranted_writes).toBe(2);
  });

  it('classifies every scenario', () => {
    expect(Object.keys(SCENARIO_KIND)).toHaveLength(13);
  });
});

describe('compareRuns', () => {
  it('lists only the scenarios whose status changed', () => {
    const before = run([result('1', 'passed'), result('3', 'failed')]);
    const after = run([result('1', 'passed'), result('3', 'passed'), result('9', 'skipped')]);
    expect(compareRuns(before, after)).toEqual([
      { scenario_id: '3', from: 'failed', to: 'passed' },
      { scenario_id: '9', from: 'pending', to: 'skipped' },
    ]);
  });
});
