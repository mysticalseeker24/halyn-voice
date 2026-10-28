import { TestRunResponseSchema } from '@halyn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appHarness, tick } from '../../test/fixtures/app';
import { suiteScenarios } from './tests';

// Halyn Test API (Step 15): a suite run in the Hub, each scenario run through /web/stage/run with suite_run_id, the
// scorecard and the comparison with the previous run; the permission map of both bundled graphs.

afterEach(() => vi.restoreAllMocks());

describe('Halyn Test API', () => {
  it('picks a pack’s scenarios', () => {
    expect(suiteScenarios('US')).toEqual(['10']);
    expect(suiteScenarios('IN')).toEqual(expect.arrayContaining(['1', '3b', '10', '12']));
    expect(suiteScenarios(null)).toHaveLength(13);
  });

  it('runs a suite, records each result, scores it and compares it with the previous run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = await appHarness();
    const token = await h.consoleToken();
    const console_ = await h.listen('console');
    const start = async () => {
      const res = await h.web('/web/tests/runs', { region: 'IN' }, token);
      expect(res.status).toBe(201);
      return TestRunResponseSchema.parse(await res.json());
    };
    const first = await start();
    expect(first.scorecard).toMatchObject({ pending: first.run.scenarios.length, passed: 0 });

    for (const id of ['1', '3b']) {
      const res = await h.web(`/web/stage/run/${id}`, { mode: 'text', suite_run_id: first.run.id }, token);
      expect(await res.json()).toMatchObject({ test_run_id: first.run.id, scenario: id });
      await h.settle();
    }
    await tick();
    const read = async (id: string) =>
      TestRunResponseSchema.parse(await (await h.web(`/web/tests/runs/${id}`, undefined, token)).json());
    const done = await read(first.run.id);
    expect(done.run.results.map((r) => [r.scenario_id, r.status])).toEqual([
      ['1', 'passed'],
      ['3b', 'skipped'],
    ]);
    expect(done.run.results[1]?.skipped[0]).toMatch(/skipped in live mode/);
    expect(done.scorecard).toMatchObject({ ungranted_writes: 0, tasks_completed: 1, passed: 1, skipped: 1 });
    expect(done.scorecard.median_propose_ms).not.toBeNull();
    const progress = console_.filter((m) => m.type === 'test_progress');
    expect(progress.at(-1)).toMatchObject({ test_run_id: first.run.id, completed: 2 });

    const second = await start();
    expect(second.previous).toMatchObject({ id: first.run.id });
    expect(second.previous?.changes).toContainEqual({ scenario_id: '1', from: 'passed', to: 'pending' });
    expect((await read('latest')).run.id).toBe(second.run.id);

    const other = await h.web('/web/stage/run/2', { mode: 'text', suite_run_id: 'trun_nope' }, token);
    expect(other.status).toBe(404);
    expect((await h.web('/web/tests/runs/latest', undefined, await h.customerToken())).status).toBe(401);
  });

  it('serves the permission map: both Aero graphs GREEN', async () => {
    const h = await appHarness();
    const res = await h.web('/web/tests/permission-map', undefined, await h.consoleToken());
    const body = (await res.json()) as { graphs: { file: string; status: string }[] };
    expect(body.graphs.map((g) => [g.file, g.status])).toEqual([
      ['aero.graph.json', 'GREEN'],
      ['aero-en.graph.json', 'GREEN'],
    ]);
  });
});
