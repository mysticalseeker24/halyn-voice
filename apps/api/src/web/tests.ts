import {
  compareRuns,
  HalynError,
  isTerminalExecution,
  newId,
  personaEnvKey,
  TEST_PERSONAS,
  TestPersonaIdSchema,
  VoicePersonasResponseSchema,
  VoiceRunResultSchema,
  VoiceRunStartResponseSchema,
  PermissionMapResponseSchema,
  scorecard,
  TestRunCreateRequestSchema,
  TestRunResponseSchema,
  type TestScenarioResult,
} from '@halyn/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import aeroEn from '../../../../agents/aero-en.graph.json';
import aero from '../../../../agents/aero.graph.json';
import { inCallingWindow } from '../confirm/start';
import { AssistantEnvSchema, BolnaEnvSchema, requireEnv } from '../env';
import { type AppDeps, flowContext } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { type HubClient, hubFor } from '../hub/client';
import { permissionMap } from '../test-runner/permission-map';
import type { ScenarioResult } from '../test-runner/runner';
import { bundledSpec } from '../test-runner/spec';
import { aeroCallFor, scoreVoiceRun } from '../test-runner/voice';
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

// ── Voice mode: real persona calls (B → A). Every call needs Saksham's go-ahead; the route only places one when the
// persona's agent id is configured, inside 09:00–21:00 IST, and never with bypass_call_guardrails. ─────────────────

function personaAgent(env: unknown, persona: string): string | null {
  const id = z.uuid().safeParse((env as Record<string, unknown>)[personaEnvKey(persona)]);
  return id.success ? id.data : null;
}

function personaParam(c: Context<AppEnv>) {
  const persona = TestPersonaIdSchema.safeParse(c.req.param('persona'));
  if (!persona.success) throw new HalynError('E_NOT_FOUND', 'No such persona');
  return persona.data as (typeof TEST_PERSONAS)[number]['id'];
}

/** GET /web/tests/voice → each persona and whether it can call now (the button stays disabled until it can). */
export function voicePersonas(deps: AppDeps) {
  return (c: Context<AppEnv>) => {
    consoleTenant(c);
    return c.json(
      VoicePersonasResponseSchema.parse({
        personas: TEST_PERSONAS.map((p) => ({
          id: p.id,
          label: p.label,
          action: p.action,
          ready: personaAgent(c.env, p.id) !== null,
        })),
        calling_window: inCallingWindow(deps.clock.nowMs()),
        bolna: BolnaEnvSchema.safeParse(c.env).success,
      }),
    );
  };
}

/** POST /web/tests/voice/:persona → `{execution_id}`: the persona's agent calls number A from number B. */
export function startVoiceRun(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const flow = flowContext(c.env, consoleTenant(c), deps);
    const persona = personaParam(c);
    const agent_id = personaAgent(c.env, persona);
    if (!agent_id) throw new HalynError('E_NOT_FOUND', 'This persona has no Bolna agent yet');
    if (!flow.bolna) throw new HalynError('E_FAIL_CLOSED', 'tests: Bolna is not configured');
    if (!inCallingWindow(deps.clock.nowMs()))
      throw new HalynError('E_BAD_REQUEST', 'Test calls only between 09:00 and 21:00 IST');
    const env = requireEnv(c.env, AssistantEnvSchema);
    const { execution_id } = await flow.bolna.startCall({
      agent_id,
      recipient_phone_number: env.NUMBER_A,
      from_phone_number: env.NUMBER_B,
      user_data: { purpose: 'halyn_test', persona, timezone: 'Asia/Kolkata' },
    });
    return c.json(VoiceRunStartResponseSchema.parse({ execution_id }), 201);
  };
}

/** GET /web/tests/voice/:persona/:execution_id → the persona call read back from Bolna and scored. */
export function voiceRunResult(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const flow = flowContext(c.env, consoleTenant(c), deps);
    const persona = personaParam(c);
    const execution_id = c.req.param('execution_id') ?? '';
    if (!flow.bolna) throw new HalynError('E_FAIL_CLOSED', 'tests: Bolna is not configured');
    const execution = await flow.bolna.getExecution(execution_id);
    if (!execution) throw new HalynError('E_NOT_FOUND', 'No such execution');
    const started = Date.parse(execution.created_at ?? '') || deps.clock.nowMs();
    const { calls, requests } = await flow.hub.consoleCalls(200);
    const aero = aeroCallFor(calls, requireEnv(c.env, AssistantEnvSchema).NUMBER_B.slice(-4), started);
    return c.json(
      VoiceRunResultSchema.parse(
        scoreVoiceRun({
          persona,
          execution_id,
          call_status: execution.status ?? null,
          ended: isTerminalExecution(execution.status),
          aero,
          requests,
        }),
      ),
    );
  };
}
