import {
  HalynError,
  OkResponseSchema,
  ScenarioIdSchema,
  StageRegionRequestSchema,
  StageRunRequestSchema,
  StageRunResponseSchema,
} from '@halyn/shared';
import type { Context } from 'hono';
import { signSession } from '../auth/session';
import { ConfirmEnvSchema, requireEnv, SessionEnvSchema, ToolEnvSchema } from '../env';
import type { AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { hubFor } from '../hub/client';
import { type AppLike, liveHarness, stageRunId } from '../test-runner/live';
import { runScenario, type ScenarioResult } from '../test-runner/runner';
import { bundledSpec } from '../test-runner/spec';
import { readJson } from './session-route';
import { testResult } from './tests';

/** Scenarios a live run cannot fit into one Worker request (3b waits out a 60 s confirmation). */
const LIVE_SKIP: Record<string, string> = {
  '3b': 'skipped in live mode: the 60 s confirmation timeout does not fit one Worker request',
};

// The Stage's controls (console sessions): run one scenario in text mode against the live Hub, so the Stage, the
// Console and the Aero app see every message as it happens (docs/UI.md), and switch the region (scenario 10). Voice
// mode places real calls and needs Saksham's go-ahead per session: it is refused here (Step 15 adds it).

function consoleTenant(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (session.kind !== 'console') throw new HalynError('E_UNAUTHORIZED', 'A console session is required');
  return session.tenant_id;
}

/** POST /web/stage/run/:scenario `{mode: "text"}` → `{test_run_id, scenario, mode}`; progress arrives as `test_progress`. */
export function stageRun(deps: AppDeps, makeApp: (deps: AppDeps) => AppLike) {
  return async (c: Context<AppEnv>) => {
    const tenant = consoleTenant(c);
    const id = ScenarioIdSchema.safeParse(c.req.param('scenario'));
    if (!id.success) throw new HalynError('E_NOT_FOUND', 'No such scenario');
    const { mode, suite_run_id } = StageRunRequestSchema.parse(await readJson(c));
    if (mode !== 'text')
      throw new HalynError('E_BAD_REQUEST', 'Voice runs place real calls: not from the Stage yet');
    const spec = bundledSpec();
    const scenario = spec.scenarios.find((s) => s.id === id.data);
    if (!scenario) throw new HalynError('E_NOT_FOUND', 'No such scenario');
    const { SESSION_SECRET } = requireEnv(c.env, SessionEnvSchema);
    const { HALYN_TOOL_SECRET, BOLNA_SOURCE_IPS } = requireEnv(c.env, ToolEnvSchema);
    const confirm = ConfirmEnvSchema.safeParse(c.env);
    if (!confirm.success) throw new HalynError('E_FAIL_CLOSED', 'The registered number is not configured');
    const now = deps.clock.nowMs();
    const { token } = await signSession(
      { tenant_id: tenant, kind: 'customer', customer_id: spec.customer.id },
      SESSION_SECRET,
      now,
    );
    const hub = hubFor(c.env, tenant);
    const suite = suite_run_id ? await hub.testRuns(suite_run_id) : null;
    if (suite_run_id && !suite?.run.scenarios.includes(id.data))
      throw new HalynError('E_NOT_FOUND', 'No such test run or scenario');
    const test_run_id = suite_run_id ?? stageRunId(deps.rng);
    let completed = suite ? suite.run.results.filter((r) => r.scenario_id !== id.data).length : 0;
    const total = suite ? suite.run.scenarios.length : 1;
    // A suite run records the result first, so the Console reads it back when test_progress arrives.
    const record = async (result: ScenarioResult) => {
      if (!suite_run_id) return;
      const run = await hub
        .recordTestResult(suite_run_id, testResult(result, new Date(deps.clock.nowMs()).toISOString()))
        .catch(() => null);
      if (run) completed = run.results.length;
    };
    const progress = (status: 'running' | 'passed' | 'failed', done: number) =>
      hub
        .broadcast(
          {
            type: 'test_progress',
            at: new Date(deps.clock.nowMs()).toISOString(),
            test_run_id,
            scenario_id: id.data,
            status,
            completed: suite_run_id ? Math.min(completed, total) : done,
            total,
          },
          ['stage', 'console'],
        )
        .catch(() => 0);
    const harness = liveHarness(
      {
        env: c.env,
        tenant,
        deps,
        makeApp,
        toolSecret: HALYN_TOOL_SECRET,
        sourceIp: BOLNA_SOURCE_IPS[0] ?? '',
        customerToken: token,
        numbers: {
          registered: confirm.data.CUSTOMER_PHONE,
          unregistered: spec.numbers.unregistered,
          assistant: spec.numbers.assistant,
          unknown_ai: spec.numbers.unknown_ai,
        },
      },
      deps.clock,
    );
    const skip = LIVE_SKIP[id.data];
    c.executionCtx.waitUntil(
      (async () => {
        await progress('running', 0);
        const result: ScenarioResult = skip
          ? {
              id: scenario.id,
              title: scenario.title,
              passed: true,
              failures: [],
              skipped: [skip],
              steps: [],
              propose_ms: [],
              ungranted_writes: 0,
            }
          : await runScenario(spec, scenario, harness);
        await record(result);
        console.log(
          JSON.stringify({
            level: result.passed ? 'info' : 'warn',
            component: 'stage',
            test_run_id,
            scenario: result.id,
            passed: result.passed,
            failures: result.failures.slice(0, 10),
            skipped: result.skipped.slice(0, 10),
          }),
        );
        await progress(result.passed ? 'passed' : 'failed', 1);
      })(),
    );
    return c.json(StageRunResponseSchema.parse({ test_run_id, scenario: id.data, mode }));
  };
}

/** POST /web/stage/region `{region}` → `{ok: true}`. */
export async function stageRegion(c: Context<AppEnv>): Promise<Response> {
  const tenant = consoleTenant(c);
  const { region } = StageRegionRequestSchema.parse(await readJson(c));
  await hubFor(c.env, tenant).setStageRegion(region);
  return c.json(OkResponseSchema.parse({ ok: true }));
}
