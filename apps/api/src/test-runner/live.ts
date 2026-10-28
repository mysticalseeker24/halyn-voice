import { base64urlEncode, type Clock, type OutcomeEvent, OutcomeEventSchema, type Rng } from '@halyn/shared';
import type { CoreTransport } from '../core-client/client';
import { CORE_ORIGIN } from '../core-client/client';
import type { AppDeps } from '../flow/context';
import { defaultCoreTransport } from '../flow/context';
import { hubFor } from '../hub/client';
import type { Harness, ToolCall } from './runner';

// The Stage's live text runs (POST /web/stage/run/:n): the runner drives the real Worker in-process against the
// tenant's live Hub (so the Stage, Console and Aero app see every WebSocket message) and the real Aero Core. Bolna is
// replaced by a recorder — no call is placed, no event leaves the Worker — and only declines are simulated (a passkey
// approval needs the customer's real device). Time is real: waits are capped so a run fits the 30 s a Worker may keep
// working after it answers; the 60 s timeout comes from the Hub's own alarm.

export interface AppLike {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
}

export interface LiveOptions {
  env: Env;
  tenant: string;
  deps: AppDeps;
  makeApp(deps: AppDeps): AppLike;
  toolSecret: string;
  sourceIp: string;
  customerToken: string;
  numbers: Harness['numbers'];
}

const MAX_WAIT_MS = 3000;

/** A random UUID from the injected rng (Bolna run ids are UUIDs; the client only addresses those). */
export function uuidFrom(rng: Rng): string {
  const b = rng.bytes(16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A stand-in for Bolna's REST API that records events and outbound calls (used by live runs and tests). */
export function bolnaRecorder(rng: Rng) {
  const events = new Map<string, OutcomeEvent[]>();
  const calls: { request_id: string; execution_id: string; user_data: Record<string, unknown> }[] = [];
  const stopped: string[] = [];
  const webCalls: { run_id: string; agent_id: string; user_data: Record<string, unknown> }[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const event = /^\/v1\/call\/([^/]+)\/events$/.exec(url.pathname);
    if (event && request.method === 'POST') {
      const run_id = decodeURIComponent(event[1] ?? '');
      const parsed = OutcomeEventSchema.safeParse(await request.json());
      if (!parsed.success) return json({ detail: 'bad event' }, 422);
      events.set(run_id, [...(events.get(run_id) ?? []), parsed.data]);
      return json({ status: 'accepted' }, 202);
    }
    if (url.pathname === '/call' && request.method === 'POST') {
      const body = (await request.json()) as { user_data?: Record<string, unknown> };
      const execution_id = uuidFrom(rng);
      const user_data = body.user_data ?? {};
      calls.push({ request_id: String(user_data.request_id ?? ''), execution_id, user_data });
      return json({ execution_id, status: 'queued' });
    }
    if (url.pathname === '/web-call/session' && request.method === 'POST') {
      const body = (await request.json()) as { agent_id: string; user_data?: Record<string, unknown> };
      const run_id = uuidFrom(rng);
      webCalls.push({ run_id, agent_id: body.agent_id, user_data: body.user_data ?? {} });
      return json({
        run_id,
        agent_id: body.agent_id,
        sip_username: 'web-test',
        sip_password: 'not-a-secret',
        sip_domain: 'sip.test.invalid',
        wss_url: 'wss://sip.test.invalid/ws',
        sip_register: false,
        expires_in: 120,
        ice_servers: [],
      });
    }
    const stop = /^\/call\/([^/]+)\/stop$/.exec(url.pathname);
    if (stop && request.method === 'POST') {
      stopped.push(decodeURIComponent(stop[1] ?? ''));
      return json({ message: 'done', status: 'stopped' });
    }
    return json({ detail: 'not found' }, 404);
  };
  return { fetch, events, calls, stopped, webCalls };
}

/** A core transport that records every request it carries. */
export function recordingTransport(inner: CoreTransport) {
  const calls: { method: string; path: string; granted: boolean; status: number }[] = [];
  const transport: CoreTransport = async (request) => {
    const path = new URL(request.url).pathname;
    const granted = request.headers.has('x-halyn-grant');
    const res = await inner(request);
    calls.push({ method: request.method, path, granted, status: res.status });
    return res;
  };
  return { transport, calls };
}

/** The waitUntil side of an ExecutionContext, so a run can wait for the background work it started. */
class Background {
  readonly pending: Promise<unknown>[] = [];
  readonly props = {};
  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise.catch(() => undefined));
  }
  passThroughOnException(): void {}
  async drain(): Promise<void> {
    while (this.pending.length > 0) await Promise.all(this.pending.splice(0));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function liveHarness(options: LiveOptions, clock: Clock): Harness {
  const bolna = bolnaRecorder(options.deps.rng);
  const core = options.deps.coreTransport?.(options.env) ?? defaultCoreTransport(options.env);
  const recorded = core ? recordingTransport(core) : null;
  const deps: AppDeps = {
    ...options.deps,
    bolnaFetch: bolna.fetch,
    coreTransport: () => recorded?.transport ?? null,
  };
  const app = options.makeApp(deps);
  const background = new Background();
  const hub = hubFor(options.env, options.tenant);

  async function call(path: string, init: RequestInit): Promise<ToolCall> {
    const started = clock.nowMs();
    const res = await app.fetch(
      new Request(`https://halyn.internal${path}`, init),
      options.env,
      background as unknown as ExecutionContext,
    );
    const ms = clock.nowMs() - started;
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body, ms };
  }

  return {
    mode: 'live',
    numbers: options.numbers,
    newRunId: () => uuidFrom(options.deps.rng),
    // A browser call needs the browser (the Aero app's "Call Aero"); live Stage runs skip it.
    webCall: async () => null,
    tool: (name, body) =>
      call(`/tools/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-halyn-secret': options.toolSecret,
          'cf-connecting-ip': options.sourceIp,
        },
        body: JSON.stringify(body),
      }),
    settle: () => background.drain(),
    advance: (ms) => sleep(Math.min(ms, MAX_WAIT_MS)),
    fireTimeouts: async () => false,
    passkey: async (request_id, answer) => {
      if (answer === 'approve') return false;
      const res = await call(`/web/approvals/${encodeURIComponent(request_id)}/decline`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.customerToken}`, 'content-type': 'application/json' },
        body: '{}',
      });
      return { status: res.status };
    },
    passToken: () => null,
    events: (run_id) => bolna.events.get(run_id) ?? [],
    outbound: () => bolna.calls.map((c) => ({ request_id: c.request_id, execution_id: c.execution_id })),
    coreCalls: () => recorded?.calls ?? [],
    directCore: async (path) => {
      if (!recorded) return { status: 0, body: null };
      const res = await recorded.transport(
        new Request(`${CORE_ORIGIN}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      );
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    request: (request_id) => hub.requestState(request_id),
    ledger: async () => {
      const head = await hub.ledgerHead();
      return { entries: head ? await hub.ledgerEntries(1, 5000) : [], head };
    },
    messages: () => null,
    logs: () => null,
  };
}

/** A short id for a Stage run. */
export function stageRunId(rng: Rng): string {
  return `trun_${base64urlEncode(rng.bytes(9)).replace(/[-_]/g, 'x')}`;
}
