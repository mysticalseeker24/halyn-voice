import {
  errorEnvelope,
  HalynError,
  type JsonValue,
  maskDeep,
  maskNumbers,
  type ReasonCode,
} from '@halyn/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Every error leaves as `{ error: { code, message, details? } }` (docs/API.md) with a reason code from @halyn/shared:
// 401 for the grant codes, 400 / 404 for requests the bank refuses, 500 E_FAIL_CLOSED for anything else (no internal
// detail; that goes to the masked log line). `details` is Aero Core's outcome hint (CoreOutcomeDetailsSchema): without
// it nothing was written; `executed` means the grant's effect committed (reconcile by reference); `unknown` means
// Aero Core could not check (retry with the same grant).

const STATUS: Partial<Record<ReasonCode, ContentfulStatusCode>> = {
  E_BAD_REQUEST: 400,
  E_GRANT_MISSING: 401,
  E_GRANT_INVALID: 401,
  E_GRANT_EXPIRED: 401,
  E_GRANT_REUSED: 401,
  E_PARAMS_MISMATCH: 401,
  E_NOT_FOUND: 404,
};

export function statusFor(code: ReasonCode): ContentfulStatusCode {
  return STATUS[code] ?? 500;
}

const FAILED_CLOSED = 'The request failed closed; nothing was changed.';
const EXECUTED = 'The request was executed, but its result could not be returned. Reconcile by reference.';
const UNKNOWN = 'The request failed closed; its outcome is unknown. Retry with the same grant.';
const CAUSE_CHARS = 300;

export function logLine(fields: Record<string, JsonValue>): void {
  console.log(JSON.stringify(maskDeep({ at: new Date().toISOString(), service: 'aero-core', ...fields })));
}

/** The cause chain, innermost (the database's own words) first, masked, then cut to 300 characters. */
function describeCause(cause: unknown): string {
  const parts: string[] = [];
  let current = cause;
  for (let depth = 0; depth < 4 && current !== undefined; depth += 1) {
    parts.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return maskNumbers(parts.reverse().join(' ← ')).slice(0, CAUSE_CHARS);
}

function publicMessage(err: unknown, status: number, code: ReasonCode): string {
  if (!(err instanceof HalynError)) return FAILED_CLOSED;
  if (status < 500) return err.message.slice(0, 500) || code;
  if (err.details?.outcome === 'executed') return EXECUTED;
  if (err.details?.outcome === 'unknown') return UNKNOWN;
  return FAILED_CLOSED;
}

export function toErrorResponse(c: Context, err: unknown): Response {
  const code: ReasonCode = err instanceof HalynError ? err.code : 'E_FAIL_CLOSED';
  const status = statusFor(code);
  const details = err instanceof HalynError ? err.details : undefined;
  const cause =
    err instanceof HalynError && code === 'E_FAIL_CLOSED' && err.cause !== undefined
      ? describeCause(err.cause)
      : undefined;
  logLine({
    level: status >= 500 ? 'error' : 'warn',
    method: c.req.method,
    path: c.req.path,
    status,
    code,
    detail: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    ...(cause === undefined ? {} : { cause }),
  });
  return c.json(errorEnvelope(code, publicMessage(err, status, code), details), status);
}

export const onError: ErrorHandler = (err, c) => toErrorResponse(c, err);

export const notFound: NotFoundHandler = (c) =>
  c.json(errorEnvelope('E_NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404);
