import { ErrorEnvelopeSchema, HalynError, type ReasonCode } from '@halyn/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { notFound, onError, statusFor, toErrorResponse } from './errors';
import { requestLog } from './request-log';

function appThrowing(err: unknown) {
  const app = new Hono();
  app.use('*', requestLog());
  app.onError(onError);
  app.notFound(notFound);
  app.get('/boom', () => {
    throw err;
  });
  return app;
}

async function body(res: Response) {
  return ErrorEnvelopeSchema.parse(await res.json());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('error handler', () => {
  it.each<[ReasonCode, number]>([
    ['E_UNAUTHORIZED', 401],
    ['E_BAD_REQUEST', 400],
    ['E_NOT_FOUND', 404],
    ['E_GRANT_MISSING', 401],
    ['E_PARAMS_MISMATCH', 401],
    ['E_FAIL_CLOSED', 500],
    ['X_PASS_INVALID', 500],
  ])('maps %s to %i', async (code, status) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await appThrowing(new HalynError(code, 'specific detail')).request('/boom');
    expect(res.status).toBe(status);
    expect(statusFor(code)).toBe(status);
    const { error } = await body(res);
    expect(error.code).toBe(code);
    // 4xx explain themselves; 5xx never leak the internal detail.
    expect(error.message).toBe(
      status < 500 ? 'specific detail' : 'The request failed closed; nothing was changed.',
    );
  });

  it('turns a Zod error into 400 E_BAD_REQUEST with the validation message', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = z.object({ run_id: z.string() }).safeParse({}).error;
    const res = await appThrowing(err).request('/boom');
    expect(res.status).toBe(400);
    const { error } = await body(res);
    expect(error.code).toBe('E_BAD_REQUEST');
    expect(error.message).toContain('run_id');
  });

  it('fails closed on anything unknown, and logs the detail masked', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await appThrowing(new Error('db said no for +918065356344')).request('/boom');
    expect(res.status).toBe(500);
    expect((await body(res)).error.code).toBe('E_FAIL_CLOSED');
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('db said no for ••••6344'))).toBe(true);
    expect(lines.join('\n')).not.toContain('8065356344');
  });

  it('fails closed on a non-Error value and answers 404 with E_NOT_FOUND for unknown routes', async () => {
    // Hono re-throws non-Error values itself; toErrorResponse still handles one if a caller passes it.
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const raw = new Hono();
    raw.get('/raw', (c) => toErrorResponse(c, 'plain string'));
    const direct = await raw.request('/raw');
    expect(direct.status).toBe(500);
    expect((await body(direct)).error.code).toBe('E_FAIL_CLOSED');
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('plain string');
    const res = await appThrowing(null).request('/nope');
    expect(res.status).toBe(404);
    expect((await body(res)).error.code).toBe('E_NOT_FOUND');
  });
});

describe('request log', () => {
  it('writes one JSON line per request with the path but never the query string', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const app = new Hono();
    app.use('*', requestLog());
    app.get('/ws', (c) => c.text('ok'));
    await app.request('/ws?token=secret-session-token');
    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'info', method: 'GET', path: '/ws', status: 200 });
    expect(JSON.stringify(line)).not.toContain('secret-session-token');
  });
});
