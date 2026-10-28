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
import { runScenario } from '../test-runner/runner';
import { bundledSpec } from '../test-runner/spec';
import { readJson } from './session-route';

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
    const { mode } = StageRunRequestSchema.parse(await readJson(c));
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
    const test_run_id = stageRunId(deps.rng);
    const hub = hubFor(c.env, tenant);
    const progress = (status: 'running' | 'passed' | 'failed', completed: number) =>
      hub
        .broadcast(
          {
            type: 'test_progress',
            at: new Date(deps.clock.nowMs()).toISOString(),
            test_run_id,
            scenario_id: id.data,
            status,
            completed,
            total: 1,
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
    c.executionCtx.waitUntil(
      (async () => {
        await progress('running', 0);
        const result = await runScenario(spec, scenario, harness);
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
