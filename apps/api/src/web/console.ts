import {
  CallDetailResponseSchema,
  CallListResponseSchema,
  type ConsoleCall,
  ConsolePassListResponseSchema,
  ConsolePassRevokeResponseSchema,
  type ConsoleRequest,
  HalynError,
  INTEGRATION_AGENTS,
  IntegrationsResponseSchema,
  maskNumbers,
  PassIdSchema,
  PolicyListResponseSchema,
  REGIONS,
  SignalsResponseSchema,
  verifyLedgerChain,
} from '@halyn/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import { isBolnaRunId } from '../bolna/client';
import { CORE_ORIGIN } from '../core-client/client';
import { BolnaEnvSchema, SarvamEnvSchema, ToolEnvSchema } from '../env';
import { flowContext, type AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import type { CallState, RequestRecord } from '../hub/types';
import { loadPacks } from '../packs/load';
import type { PassRow } from '../pass';
import { summary } from './passes';

// Halyn Console (docs/UI.md, Step 13): console sessions only, every read from the tenant's Hub (never TiDB). The
// Console sees ids, codes, counts and Halyn's own action summaries — never a caller's words or a full number.

export function consoleTenant(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (session.kind !== 'console') throw new HalynError('E_UNAUTHORIZED', 'A console session is required');
  return session.tenant_id;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function consoleRequest(r: RequestRecord): ConsoleRequest {
  return {
    request_id: r.request_id,
    run_id: r.run_id,
    action: r.action,
    summary: r.summary,
    outcome: r.decision.outcome,
    final_outcome: r.final_outcome,
    status: r.status,
    tier: r.decision.tier,
    base_tier: r.decision.base_tier,
    reasons: r.decision.reasons,
    signals: r.gate.signals,
    cues: r.coaching.cues,
    coaching_score: r.coaching.score,
    handoff_id: r.handoff_id,
    created_at: iso(r.created_at),
  };
}

function consoleCall(call: CallState, requests: readonly RequestRecord[]): ConsoleCall {
  const mine = requests.filter((r) => r.run_id === call.run_id);
  return {
    run_id: call.run_id,
    channel: call.channel,
    region: call.region,
    customer_id: call.customer_id,
    kind: call.kind,
    registered: call.registered,
    from_last4: call.from_last4,
    pass_id: call.pass_id,
    purpose: call.purpose,
    started_at: iso(call.started_at),
    ended_at: call.ended_at === null ? null : iso(call.ended_at),
    requests: mine.length,
    last_outcome: mine.at(-1)?.decision.outcome ?? null,
    has_recording: Boolean(call.recording_url),
  };
}

/** GET /web/calls → the newest 50 calls. */
export function listCalls(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { calls, requests } = await flowContext(c.env, consoleTenant(c), deps).hub.consoleCalls(50);
    return c.json(CallListResponseSchema.parse({ calls: calls.map((call) => consoleCall(call, requests)) }));
  };
}

/** GET /web/calls/:run_id → the call, its requests, handoffs, Bolna's transcript (numbers masked) and recording. */
export function callDetail(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const flow = flowContext(c.env, consoleTenant(c), deps);
    const found = await flow.hub.consoleCall(c.req.param('id') ?? '');
    if (!found) throw new HalynError('E_NOT_FOUND', 'No such call');
    const { call, requests, handoffs } = found;
    const execution =
      flow.bolna && isBolnaRunId(call.run_id) ? await flow.bolna.getExecution(call.run_id) : null;
    const recording = z
      .url()
      .safeParse(call.recording_url ?? execution?.telephony_data?.recording_url ?? undefined);
    return c.json(
      CallDetailResponseSchema.parse({
        call: consoleCall(call, requests),
        requests: requests.map(consoleRequest),
        handoffs,
        transcript: execution?.transcript ? maskNumbers(execution.transcript).slice(-20_000) : null,
        transcript_status: execution?.transcript ? 'ok' : flow.bolna && execution ? 'none' : 'unavailable',
        recording_url: recording.success ? recording.data : null,
      }),
    );
  };
}

/** GET /web/policies → the compiled packs in KV (read-only; "test this pack" runs that region's scenarios). */
export async function listPolicies(c: Context<AppEnv>): Promise<Response> {
  const packs = await loadPacks(c.env.CONFIG, consoleTenant(c));
  return c.json(
    PolicyListResponseSchema.parse({
      packs: REGIONS.flatMap((r) => (packs[r] ? [packs[r]] : [])),
      missing: REGIONS.filter((r) => !packs[r]),
    }),
  );
}

function consolePass(row: PassRow, now: number) {
  return { ...summary(row, now), customer_id: row.customer_id };
}

/** GET /web/console/passes → every Pass of the tenant. */
export function consolePasses(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const rows = await flowContext(c.env, consoleTenant(c), deps).hub.consolePasses();
    const now = deps.clock.nowMs();
    return c.json(ConsolePassListResponseSchema.parse({ passes: rows.map((r) => consolePass(r, now)) }));
  };
}

/** DELETE /web/console/passes/:id → `{pass}` revoked (the ledger records pass_revoked). */
export function consoleRevokePass(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const hub = flowContext(c.env, consoleTenant(c), deps).hub;
    const id = PassIdSchema.safeParse(c.req.param('id'));
    const pass = id.success ? (await hub.consolePasses()).find((p) => p.id === id.data) : undefined;
    const row = pass ? await hub.revokePass(pass.customer_id, pass.id) : null;
    if (!row) throw new HalynError('E_NOT_FOUND', 'No such Pass');
    return c.json(ConsolePassRevokeResponseSchema.parse({ pass: consolePass(row, deps.clock.nowMs()) }));
  };
}

function counts<K extends string>(values: readonly K[]): { key: K; count: number }[] {
  const map = new Map<K, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/** GET /web/signals → counts over the newest 500 requests, and the newest 20 that raised a signal or a cue. */
export function signalsRoute(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const requests = await flowContext(c.env, consoleTenant(c), deps).hub.consoleRequests(500);
    const flagged = requests.filter((r) => r.gate.signals.length > 0 || r.coaching.cues.length > 0);
    return c.json(
      SignalsResponseSchema.parse({
        window: { requests: requests.length, since: requests.length ? iso(requests.at(-1)!.created_at) : null },
        signals: counts(requests.flatMap((r) => r.gate.signals)).map(({ key, count }) => ({ code: key, count })),
        reasons: counts(requests.flatMap((r) => r.decision.reasons)).map(({ key, count }) => ({ code: key, count })),
        cues: counts(requests.flatMap((r) => r.coaching.cues)).map(({ key, count }) => ({ cue: key, count })),
        latest: flagged.slice(0, 20).map((r) => {
          const { request_id, run_id, action, outcome, signals, cues, coaching_score, created_at } = consoleRequest(r);
          return { request_id, run_id, action, outcome, signals, cues, coaching_score, created_at };
        }),
      }),
    );
  };
}

const MAX_EXPORT = 5000;

/** GET /web/ledger/export → the chain as a JSON download (entries, head anchor, verify result). */
export function ledgerExport(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const tenant = consoleTenant(c);
    const hub = flowContext(c.env, tenant, deps).hub;
    const head = await hub.ledgerHead();
    if (head && head.seq > MAX_EXPORT)
      throw new HalynError('E_BAD_REQUEST', 'The ledger is too long to export here');
    const entries = head ? await hub.ledgerEntries(1, MAX_EXPORT) : [];
    const verify = await verifyLedgerChain(entries, head ? { anchor: head } : {});
    c.header('content-disposition', `attachment; filename="halyn-ledger-${tenant}.json"`);
    return c.json({ tenant_id: tenant, exported_at: iso(deps.clock.nowMs()), head, verify, entries });
  };
}

const AGENT_ENV: Record<(typeof INTEGRATION_AGENTS)[number], string> = {
  aero_in: 'BOLNA_AERO_AGENT_ID',
  aero_en: 'BOLNA_AERO_EN_AGENT_ID',
  confirm: 'BOLNA_CONFIRM_AGENT_ID',
  assistant: 'BOLNA_ASSISTANT_AGENT_ID',
};

/** GET /web/integrations → Bolna agents, Halyn's guards (booleans), Aero Core health and the Hub's backlog. */
export function integrations(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const flow = flowContext(c.env, consoleTenant(c), deps);
    const env = c.env as unknown as Record<string, unknown>;
    const agents = await Promise.all(
      INTEGRATION_AGENTS.map(async (role) => {
        const id = z.uuid().safeParse(env[AGENT_ENV[role]]);
        const info = id.success && flow.bolna ? await flow.bolna.getAgent(id.data) : null;
        return {
          role,
          agent_id: id.success ? id.data : null,
          name: info?.name ?? null,
          status: info?.status ?? null,
          restricted: info?.restricted ?? null,
          webhook_host: info?.webhook_host ?? null,
          error: !id.success
            ? 'not configured'
            : !flow.bolna
              ? 'Bolna key missing'
              : info
                ? null
                : 'Bolna did not return the agent',
        };
      }),
    );
    const ips = ToolEnvSchema.pick({ BOLNA_SOURCE_IPS: true }).safeParse(c.env);
    const started = deps.clock.nowMs();
    let coreOk = false;
    if (flow.core)
      try {
        const res = await flow.core(new Request(`${CORE_ORIGIN}/health`, { signal: AbortSignal.timeout(3000) }));
        coreOk = res.ok;
        await res.body?.cancel();
      } catch {
        coreOk = false;
      }
    const [mirror_backlog, sockets] = await Promise.all([flow.hub.mirrorBacklog(), flow.hub.sockets()]);
    return c.json(
      IntegrationsResponseSchema.parse({
        agents,
        guards: {
          ip_allowlist: ips.success && ips.data.BOLNA_SOURCE_IPS.length > 0,
          tool_secret: ToolEnvSchema.pick({ HALYN_TOOL_SECRET: true }).safeParse(c.env).success,
          bolna_key: BolnaEnvSchema.safeParse(c.env).success,
          sarvam_key: SarvamEnvSchema.safeParse(c.env).success,
        },
        aero_core: { ok: coreOk, ms: flow.core ? Math.max(0, deps.clock.nowMs() - started) : null },
        hub: { mirror_backlog, sockets },
      }),
    );
  };
}
