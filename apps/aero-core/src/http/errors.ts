import { errorEnvelope, HalynError, type JsonValue, maskDeep, type ReasonCode } from '@halyn/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Every error leaves as `{ error: { code, message } }` (docs/API.md) with a reason code from @halyn/shared: 401 for the
// grant codes, 400 / 404 for requests the bank refuses, 500 E_FAIL_CLOSED for anything else (no internal detail; that
// goes to the masked log line). Any error means nothing was written: writes happen in one atomic D1 batch.

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

export function logLine(fields: Record<string, JsonValue>): void {
  console.log(JSON.stringify(maskDeep({ at: new Date().toISOString(), service: 'aero-core', ...fields })));
}

export function toErrorResponse(c: Context, err: unknown): Response {
  const code: ReasonCode = err instanceof HalynError ? err.code : 'E_FAIL_CLOSED';
  const status = statusFor(code);
  const message =
    err instanceof HalynError && status < 500 ? err.message.slice(0, 500) || code : FAILED_CLOSED;
  logLine({
    level: status >= 500 ? 'error' : 'warn',
    method: c.req.method,
    path: c.req.path,
    status,
    code,
    detail: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
  });
  return c.json(errorEnvelope(code, message), status);
}

export const onError: ErrorHandler = (err, c) => toErrorResponse(c, err);

export const notFound: NotFoundHandler = (c) =>
  c.json(errorEnvelope('E_NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404);
