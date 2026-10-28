import {
  compareRuns,
  HalynError,
  newId,
  PermissionMapResponseSchema,
  scorecard,
  TestRunCreateRequestSchema,
  TestRunResponseSchema,
  type TestScenarioResult,
} from '@halyn/shared';
import type { Context } from 'hono';
import aeroEn from '../../../../agents/aero-en.graph.json';
import aero from '../../../../agents/aero.graph.json';
import type { AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { type HubClient, hubFor } from '../hub/client';
import { permissionMap } from '../test-runner/permission-map';
import type { ScenarioResult } from '../test-runner/runner';
import { bundledSpec } from '../test-runner/spec';
import { consoleTenant } from './console';
import { readJson } from './session-route';

// Halyn Test (Step 15): a suite run lives in the tenant's Hub; the Console runs each scenario with
// POST /web/stage/run/:scenario {suite_run_id} (one request each, its own 30 s) and the result lands here.

/** The scenarios of a pack: its own region's, plus the one that compares its decision in that region (10). */
export function suiteScenarios(region: 'IN' | 'US' | null): string[] {
  return bundledSpec()
    .scenarios.filter((s) => region === null || s.region === region || s.compare_in_region === region)
    .map((s) => s.id);
}

/** A runner result as the scorecard stores it. */
export function testResult(result: ScenarioResult, at: string): TestScenarioResult {
  const clip = (lines: string[]) => lines.slice(0, 20).map((l) => l.slice(0, 300));
  return {
    scenario_id: result.id,
    title: result.title.slice(0, 120),
    status:
      result.failures.length > 0
        ? 'failed'
        : result.steps.length === 0 && result.skipped.length > 0
          ? 'skipped'
          : 'passed',
    failures: clip(result.failures),
    skipped: clip(result.skipped),
    ungranted_writes: result.ungranted_writes,
    propose_ms: result.propose_ms.slice(0, 100).map((ms) => Math.max(0, Math.round(ms))),
    finished_at: at,
  };
}

async function runResponse(hub: HubClient, id: string | null) {
  const found = await hub.testRuns(id);
  if (!found) throw new HalynError('E_NOT_FOUND', 'No such test run');
  const { run, previous } = found;
  return TestRunResponseSchema.parse({
    run,
    scorecard: scorecard(run),
    previous: previous
      ? { id: previous.id, scorecard: scorecard(previous), changes: compareRuns(previous, run) }
      : null,
  });
}

/** POST /web/tests/runs `{region}` → the new run (no results yet) and the comparison with the run before it. */
export function createTestRun(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const hub = hubFor(c.env, consoleTenant(c));
    const { region } = TestRunCreateRequestSchema.parse(await readJson(c));
    const run = await hub.createTestRun({
      id: newId('trun', deps.clock, deps.rng),
      region,
      mode: 'text',
      started_at: new Date(deps.clock.nowMs()).toISOString(),
      scenarios: suiteScenarios(region),
      results: [],
    });
    return c.json(await runResponse(hub, run.id), 201);
  };
}

/** GET /web/tests/runs/:id (or `latest`) → the run, its scorecard and the changes since the previous run. */
export async function testRunRoute(c: Context<AppEnv>): Promise<Response> {
  const hub = hubFor(c.env, consoleTenant(c));
  const id = c.req.param('id') ?? 'latest';
  return c.json(await runResponse(hub, id === 'latest' ? null : id));
}

/** GET /web/tests/permission-map → both bundled Aero graphs, GREEN or RED. */
export function permissionMapRoute(c: Context<AppEnv>): Response {
  consoleTenant(c);
  return c.json(
    PermissionMapResponseSchema.parse({
      graphs: [permissionMap('aero.graph.json', aero), permissionMap('aero-en.graph.json', aeroEn)],
    }),
  );
}
