import { CORE_RESPONSES, coreEndpoints, HalynError } from '@halyn/shared';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { seedCustomer, testEnv } from '../test/fixtures/env';
import { mintGrant } from '../test/fixtures/grants';
import { BASE, coreRequest, reply, testApp } from '../test/fixtures/http';
import { statusFor, toErrorResponse } from './http/errors';

const NOW_MS = Date.UTC(2026, 9, 27, 4, 30, 0);
const send = testApp(NOW_MS);

describe('Aero Core app', () => {
  it('serves /health without any configuration', async () => {
    expect(await reply(send(new Request(`${BASE}/health`), {}))).toEqual({
      status: 200,
      body: { ok: true, service: 'aero-core' },
    });
  });

  it.each(coreEndpoints().map((e) => [`${e.method} ${e.path}`, e] as const))(
    '%s without x-halyn-grant → 401 E_GRANT_MISSING',
    async (_, endpoint) => {
      const res = await reply(send(new Request(`${BASE}${endpoint.path}`, { method: endpoint.method })));
      expect(res).toEqual({
        status: 401,
        body: { error: { code: 'E_GRANT_MISSING', message: 'An x-halyn-grant header is required' } },
      });
    },
  );

  it('unknown routes and wrong methods → 404 E_NOT_FOUND', async () => {
    for (const request of [new Request(`${BASE}/core/nope`), new Request(`${BASE}/core/cards/freeze`)])
      expect((await reply(send(request))).body).toMatchObject({ error: { code: 'E_NOT_FOUND' } });
  });

  it('missing configuration fails closed (500) and changes nothing', async () => {
    const sub = await seedCustomer();
    const params = { card_last4: '8812' };
    const { token } = await mintGrant({ action: 'card.freeze', params, sub, iat: NOW_MS / 1000 });
    const env = { ...testEnv(), HALYN_PUBLIC_JWKS: undefined };
    expect(await reply(send(coreRequest('card.freeze', params, token), env))).toEqual({
      status: 500,
      body: { error: { code: 'E_FAIL_CLOSED', message: 'The request failed closed; nothing was changed.' } },
    });
  });

  it('HEAD on a core route → 405 before the grant is read, so the grant stays usable', async () => {
    const sub = await seedCustomer();
    const params = { account: 'savings' };
    const { token } = await mintGrant({ action: 'balance.view', params, sub, iat: NOW_MS / 1000 });
    const get = coreRequest('balance.view', params, token);
    const head = await send(new Request(get.url, { method: 'HEAD', headers: get.headers }));
    expect(head.status).toBe(405);
    expect((await reply(send(coreRequest('balance.view', params, token)))).status).toBe(200);
  });

  it('runs the action of a valid grant (end to end through the router)', async () => {
    const sub = await seedCustomer();
    const params = { account: 'savings' };
    const { token } = await mintGrant({ action: 'balance.view', params, sub, iat: NOW_MS / 1000 });
    const res = await reply(send(coreRequest('balance.view', params, token)));
    expect(CORE_RESPONSES['balance.view'].parse(res.body).as_of).toBe(new Date(NOW_MS).toISOString());
  });
});

describe('error envelope', () => {
  it('maps grant codes to 401, refusals to 400/404 and everything else to 500', () => {
    for (const code of [
      'E_GRANT_MISSING',
      'E_GRANT_INVALID',
      'E_GRANT_EXPIRED',
      'E_GRANT_REUSED',
      'E_PARAMS_MISMATCH',
    ] as const)
      expect(statusFor(code)).toBe(401);
    expect(statusFor('E_BAD_REQUEST')).toBe(400);
    expect(statusFor('E_NOT_FOUND')).toBe(404);
    expect(statusFor('E_FAIL_CLOSED')).toBe(500);
    expect(statusFor('P_TIER0')).toBe(500);
  });

  it('hides internal detail on 5xx, keeps the message on 4xx, and masks the log line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const app = new Hono();
    app.get('/boom', (c) => toErrorResponse(c, new Error('D1 exploded near +919000000001')));
    app.get('/string', (c) => toErrorResponse(c, 'plain string'));
    app.get('/refused', (c) => toErrorResponse(c, new HalynError('E_BAD_REQUEST', 'No such thing')));
    try {
      expect(await reply(app.request('/boom'))).toEqual({
        status: 500,
        body: {
          error: { code: 'E_FAIL_CLOSED', message: 'The request failed closed; nothing was changed.' },
        },
      });
      expect(await reply(app.request('/string'))).toMatchObject({ status: 500 });
      expect(await reply(app.request('/refused'))).toEqual({
        status: 400,
        body: { error: { code: 'E_BAD_REQUEST', message: 'No such thing' } },
      });
      const lines = log.mock.calls.map(([line]) => String(line));
      expect(lines.join('\n')).not.toContain('+919000000001');
      expect(lines[0]).toContain('••••0001');
    } finally {
      log.mockRestore();
    }
  });
});
