import { errorEnvelope, HalynError, type JsonValue, maskDeep, type ReasonCode } from '@halyn/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

// Every error leaves as `{ error: { code, message } }` (docs/API.md) with a reason code from @halyn/shared.
// 5xx bodies never carry internal detail; the detail goes to the (masked) log line instead.

const STATUS: Partial<Record<ReasonCode, ContentfulStatusCode>> = {
  E_BAD_REQUEST: 400,
  E_UNAUTHORIZED: 401,
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
  console.log(JSON.stringify(maskDeep({ at: new Date().toISOString(), ...fields })));
}

/** Turn anything thrown into the error envelope. Unknown errors are E_FAIL_CLOSED (invariant 2). */
export function toErrorResponse(c: Context, err: unknown): Response {
  let code: ReasonCode = 'E_FAIL_CLOSED';
  let message = FAILED_CLOSED;
  if (err instanceof HalynError) {
    code = err.code;
    if (statusFor(code) < 500) message = err.message.slice(0, 500) || code;
  } else if (err instanceof z.ZodError) {
    code = 'E_BAD_REQUEST';
    message = z.prettifyError(err).slice(0, 500);
  }
  const status = statusFor(code);
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
