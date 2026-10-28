import {
  BolnaCallResponseSchema,
  type BolnaExecution,
  BolnaExecutionSchema,
  E164Schema,
  HalynError,
  maskNumbers,
  type OutcomeEvent,
  OutcomeEventSchema,
  type WebCallSession,
  WebCallSessionSchema,
} from '@halyn/shared';
import { z } from 'zod';

// Bolna's REST API, typed (docs/BOLNA.md "Events", "Outbound calls"; verified against Bolna's docs 2026-10-28):
//   POST /v1/call/{run_id}/events   {event, properties} → 202 accepted; 404 once the call has ended (graph agents only)
//   POST /call                      {agent_id, recipient_phone_number, from_phone_number, user_data} → {execution_id}
//   POST /call/{execution_id}/stop  stops a queued or scheduled call
//   GET  /executions/{id}           the execution record
// `fetch` is injected: the Worker passes the global fetch, tests a recorder. Nothing here throws on an event: a call
// that has ended is a normal outcome (the decision stands and the app shows it, docs/ARCHITECTURE.md).

export const BOLNA_API_BASE = 'https://api.bolna.ai';
const DEFAULT_TIMEOUT_MS = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FetchLike = (request: Request) => Promise<Response>;

export interface BolnaClientOptions {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
}

export type EventDelivery =
  | { delivered: true }
  | {
      delivered: false;
      reason: 'call_ended' | 'rejected' | 'unreachable' | 'no_run_id';
      status: number | null;
    };

export const OutboundCallSchema = z.strictObject({
  agent_id: z.string().regex(UUID, 'agent id must be a UUID'),
  recipient_phone_number: E164Schema,
  from_phone_number: E164Schema,
  user_data: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])),
});
export type OutboundCall = z.infer<typeof OutboundCallSchema>;

/**
 * A run id we can address: Bolna's execution ids are UUIDs. Synthetic ids (`sid:…` when the run id did not
 * substitute, `stage_…` for Stage text runs) have no live call to inject into.
 */
export function isBolnaRunId(run_id: string): boolean {
  return UUID.test(run_id);
}

function log(fields: Record<string, unknown>): void {
  console.log(maskNumbers(JSON.stringify({ at: new Date().toISOString(), component: 'bolna', ...fields })));
}

export function createBolnaClient(options: BolnaClientOptions) {
  const base = (options.baseUrl ?? BOLNA_API_BASE).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return options.fetch(
      new Request(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
  }

  async function json(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }

  return {
    /** Inject an outcome event into a live call. One retry on a 5xx or network error; 404 = the call has ended. */
    async sendEvent(run_id: string, event: OutcomeEvent): Promise<EventDelivery> {
      const parsed = OutcomeEventSchema.parse(event);
      if (!isBolnaRunId(run_id)) return { delivered: false, reason: 'no_run_id', status: null };
      let status: number | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await send('POST', `/v1/call/${encodeURIComponent(run_id)}/events`, parsed);
          status = res.status;
          await res.body?.cancel();
          if (res.ok) return { delivered: true };
          if (res.status === 404) {
            log({ level: 'info', event: parsed.event, run_id, result: 'call_ended' });
            return { delivered: false, reason: 'call_ended', status };
          }
          if (res.status < 500) break;
        } catch {
          status = null;
        }
      }
      log({ level: 'warn', event: parsed.event, run_id, result: 'not_delivered', status });
      return {
        delivered: false,
        reason: status === null || status >= 500 ? 'unreachable' : 'rejected',
        status,
      };
    },

    /** Place an outbound call. Never sends `bypass_call_guardrails` (docs/COMPLIANCE.md). Throws on any failure. */
    async startCall(call: OutboundCall): Promise<{ execution_id: string }> {
      const body = OutboundCallSchema.parse(call);
      if (Object.keys(body.user_data).some((k) => k.includes('bypass_call_guardrails')))
        throw new HalynError('E_FAIL_CLOSED', 'bolna: bypass_call_guardrails is forbidden');
      let res: Response;
      try {
        res = await send('POST', '/call', body);
      } catch {
        throw new HalynError('E_FAIL_CLOSED', 'bolna: outbound call request failed');
      }
      const parsed = BolnaCallResponseSchema.safeParse(await json(res));
      if (!res.ok || !parsed.success) {
        log({ level: 'warn', call: 'start', status: res.status });
        throw new HalynError('E_FAIL_CLOSED', `bolna: outbound call refused (${res.status})`);
      }
      return { execution_id: parsed.data.execution_id };
    },

    /**
     * Mint a single-use Web Call SDK session (docs/BOLNA.md "Web calls"): `{run_id, sip_*, wss_url, ice_servers, …}`
     * for the browser — the Bolna key stays here. Throws on any failure.
     */
    async mintWebCall(input: {
      agent_id: string;
      user_data: Record<string, string>;
    }): Promise<WebCallSession> {
      let res: Response;
      try {
        res = await send('POST', '/web-call/session', input);
      } catch {
        throw new HalynError('E_FAIL_CLOSED', 'bolna: web call session request failed');
      }
      const parsed = WebCallSessionSchema.safeParse(await json(res));
      if (!res.ok || !parsed.success) {
        log({ level: 'warn', call: 'web_session', status: res.status });
        throw new HalynError('E_FAIL_CLOSED', `bolna: web call session refused (${res.status})`);
      }
      return parsed.data;
    },

    /** Stop a queued or scheduled call (an answered call cannot be stopped this way). Best effort. */
    async stopCall(execution_id: string): Promise<boolean> {
      if (!isBolnaRunId(execution_id)) return false;
      try {
        const res = await send('POST', `/call/${encodeURIComponent(execution_id)}/stop`);
        await res.body?.cancel();
        return res.ok;
      } catch {
        return false;
      }
    },

    /** The execution record, or null when Bolna has none (or is unreachable). */
    async getExecution(id: string): Promise<BolnaExecution | null> {
      try {
        const res = await send('GET', `/executions/${encodeURIComponent(id)}`);
        if (!res.ok) {
          await res.body?.cancel();
          return null;
        }
        const parsed = BolnaExecutionSchema.safeParse(await json(res));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

export type BolnaClient = ReturnType<typeof createBolnaClient>;
