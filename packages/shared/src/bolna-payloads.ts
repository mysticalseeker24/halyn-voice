import { z } from 'zod';
import { ACTION_PARAMS, ActionIdSchema } from './actions';

// What Bolna sends us: custom-function (tool) bodies and execution records (webhooks, pre-call webhooks,
// GET /executions/{id}). docs/BOLNA.md "Custom functions": every tool param is a `%(name)s` substitution, so values
// arrive as strings — or as the literal placeholder when Bolna could not fill it, or empty. This module turns such a
// body into the shape the strict tool schemas in api.ts expect (ADR-010: lenient envelope, strict params), and
// nothing more: it never invents a value, it only drops unfilled ones and reads "true"/"4500000" as what they say.
// Pure. Real recorded payloads in tests/fixtures/bolna are contract-tested against these (apps/api/test/contract).

export const BOLNA_TOOLS = [
  'lookup_customer',
  'verify_pass',
  'propose_action',
  'get_pass_code',
  'confirm_result',
  'check_decision',
] as const;
export const BolnaToolSchema = z.enum(BOLNA_TOOLS);
export type BolnaTool = z.infer<typeof BolnaToolSchema>;

/** An unsubstituted `%(name)s`, or Python's/JS's spelling of "nothing". */
const PLACEHOLDER = /%\(|^(?:none|null|undefined|nan)$/i;
const MAX_STRING = 4000;

/** A substituted value, or undefined when Bolna left it missing, empty, null or as its placeholder. */
export function bolnaValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' || PLACEHOLDER.test(trimmed) ? undefined : trimmed.slice(0, MAX_STRING);
}

/** "true"/"yes"/"1" and "false"/"no"/"0" (any case) become booleans; anything else is left for the schema. */
export function bolnaBoolean(value: unknown): unknown {
  const v = bolnaValue(value);
  if (typeof v !== 'string') return v;
  const lower = v.toLowerCase();
  if (lower === 'true' || lower === 'yes' || lower === '1') return true;
  if (lower === 'false' || lower === 'no' || lower === '0') return false;
  return v;
}

/**
 * A phone number as Bolna may write it → E.164. Spaces, dashes and brackets go; a number without "+" is read as an
 * international number (11–15 digits), an Indian trunk-prefixed number (0 + 10 digits) or an Indian mobile
 * (10 digits starting 6–9: number A is an Indian line). Anything else is passed through for the schema to refuse.
 */
export function bolnaPhone(value: unknown): unknown {
  const v = bolnaValue(value);
  if (typeof v !== 'string') return v;
  const compact = v.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return compact;
  if (/^0[6-9]\d{9}$/.test(compact)) return `+91${compact.slice(1)}`;
  if (/^[6-9]\d{9}$/.test(compact)) return `+91${compact}`;
  if (/^[1-9]\d{10,14}$/.test(compact)) return `+${compact}`;
  return v;
}

/** Caller quotes: an array, a JSON array written as a string, or plain text (one quote per line). */
export function bolnaQuotes(value: unknown): unknown {
  const v = bolnaValue(value);
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map(bolnaValue).filter((q): q is string => typeof q === 'string');
  if (typeof v !== 'string') return v;
  if (v.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return bolnaQuotes(parsed);
    } catch {
      // not JSON after all: plain text
    }
  }
  return v
    .split(/\n+/)
    .map((q) => q.trim())
    .filter(Boolean);
}

/** "approve"/"yes"/"approved" → approve, "decline"/"no"/"declined" → decline. */
export function bolnaAnswer(value: unknown): unknown {
  const v = bolnaValue(value);
  if (typeof v !== 'string') return v;
  const lower = v.toLowerCase();
  if (['approve', 'approved', 'yes', 'haan', 'ha'].includes(lower)) return 'approve';
  if (['decline', 'declined', 'no', 'nahi', 'nahin'].includes(lower)) return 'decline';
  return v;
}

/** A spoken or typed Pass code; numbers are written as digits. */
function bolnaCode(value: unknown): unknown {
  const v = bolnaValue(value);
  return typeof v === 'number' && Number.isSafeInteger(v) ? String(v).padStart(6, '0') : v;
}

function isIntegerParam(action: unknown, key: string): boolean {
  const id = ActionIdSchema.safeParse(action);
  if (!id.success) return false;
  const shape = ACTION_PARAMS[id.data].shape as Record<string, z.ZodType | undefined>;
  return Object.hasOwn(shape, key) && shape[key]?.def.type === 'number';
}

/** Own property even for "__proto__", so the strict per-action schema sees (and refuses) it. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * The proposed action's params: a `params` object, a `params` JSON string, or — when the agent's tool maps each
 * param to its own key, as the Day-0 agent does — the action's param names collected from the body. Unfilled values
 * are dropped (an optional param the caller never gave); integer params written as digit strings become numbers.
 */
export function bolnaParams(action: unknown, body: Record<string, unknown>): unknown {
  let params = bolnaValue(body.params);
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params) as unknown;
    } catch {
      return params; // not an object: the envelope schema refuses it
    }
  }
  if (params === undefined) {
    const id = ActionIdSchema.safeParse(action);
    params = {};
    if (id.success)
      for (const key of Object.keys(ACTION_PARAMS[id.data].shape))
        if (Object.hasOwn(body, key)) setOwn(params as Record<string, unknown>, key, body[key]);
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return params;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(params)) {
    const value = bolnaValue(raw);
    if (value === undefined) continue;
    const integer = isIntegerParam(action, key) && typeof value === 'string' && /^\d{1,15}$/.test(value);
    setOwn(out, key, integer ? Number(value) : value);
  }
  return out;
}

/**
 * A tool body as the strict request schema expects it (api.ts). `run_id` stays undefined when Bolna could not
 * substitute it; the API then falls back to the call's `call_sid` (docs/BOLNA.md, ADR-016). Agents send the run id
 * as `halyn_run_id`: Bolna refuses a tool param named `run_id` (it clashes with its own keyword; Day-0 check 2).
 */
export function normalizeToolBody(tool: BolnaTool, raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const body = raw as Record<string, unknown>;
  const common = {
    run_id: bolnaValue(body.halyn_run_id ?? body.run_id ?? body.execution_id),
    call_sid: bolnaValue(body.call_sid),
  };
  switch (tool) {
    case 'lookup_customer':
      return {
        ...common,
        from_number: bolnaPhone(body.from_number),
        claimed_name: bolnaValue(body.claimed_name),
      };
    case 'verify_pass':
      return { ...common, from_number: bolnaPhone(body.from_number), code: bolnaCode(body.code) };
    case 'propose_action': {
      const action = bolnaValue(body.action);
      return {
        ...common,
        from_number: bolnaPhone(body.from_number),
        channel: bolnaValue(body.channel) ?? 'phone',
        action,
        params: bolnaParams(action, body),
        readback_confirmed: bolnaBoolean(body.readback_confirmed),
        caller_quotes: bolnaQuotes(body.caller_quotes),
      };
    }
    case 'get_pass_code':
      return {
        ...common,
        pass_token: bolnaValue(body.pass_token),
        from_number: bolnaPhone(body.from_number),
      };
    case 'confirm_result':
      return {
        ...common,
        request_id: bolnaValue(body.request_id),
        answer: bolnaAnswer(body.answer),
        method: bolnaValue(body.method) ?? 'speech',
      };
    case 'check_decision':
      return { ...common, request_id: bolnaValue(body.request_id) };
  }
}

// ── Execution records ─────────────────────────────────────────────────────────────────────────────

const Text = (max: number) => z.string().max(max).nullish();

/**
 * Bolna's execution record (docs/BOLNA.md; Bolna's "execution payload reference"). The same shape arrives as the
 * agent webhook (several times per call, keyed by `id`), the tool's pre-call webhook (status `in-progress` plus the
 * tool's `pre_call_webhook_param` fields) and GET /executions/{id}. Lenient: unknown keys are stripped and every field
 * but `id` may be missing or null (PII masking nulls numbers).
 */
export const BolnaExecutionSchema = z.object({
  id: z.string().min(1).max(128),
  agent_id: Text(128),
  status: Text(64),
  termination_reason: Text(128),
  conversation_duration: z.number().nonnegative().nullish(),
  created_at: Text(64),
  updated_at: Text(64),
  user_number: Text(32),
  agent_number: Text(32),
  transcript: Text(200_000),
  telephony_data: z
    .object({
      from_number: Text(32),
      to_number: Text(32),
      recording_url: Text(1024),
      call_type: Text(32),
      provider_call_id: Text(128),
      call_sid: Text(128),
    })
    .nullish(),
  context_details: z
    .object({
      recipient_phone_number: Text(32),
      recipient_data: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
  /** Pre-call webhooks carry the tool's own params (docs/BOLNA.md: `pre_call_webhook_param`). */
  tool: Text(64),
});
export type BolnaExecution = z.infer<typeof BolnaExecutionSchema>;

/** Statuses after which nothing about the execution changes (Bolna AGENTS.md). */
export const BOLNA_TERMINAL_STATUSES = [
  'completed',
  'no-answer',
  'busy',
  'failed',
  'canceled',
  'stopped',
  'error',
  'balance-low',
] as const;

export function isTerminalExecution(status: string | null | undefined): boolean {
  return (BOLNA_TERMINAL_STATUSES as readonly string[]).includes(status ?? '');
}

/** POST /call → `{execution_id, status: "queued"}`. */
export const BolnaCallResponseSchema = z.object({
  execution_id: z.string().min(1).max(128),
  status: z.string().max(64).optional(),
});

/** POST /v1/call/{run_id}/events → 202 `{status: "accepted"}`, or 404 `{detail}` once the call has ended. */
export const BolnaEventAcceptedSchema = z.object({ status: z.literal('accepted') });
export const BolnaEventRefusedSchema = z.object({ detail: z.string().max(500) });

/** POST /call/{execution_id}/stop → `{message: "done", status: "stopped", execution_id}` (queued or scheduled only). */
export const BolnaStopResponseSchema = z.object({ status: z.string().max(64) });
