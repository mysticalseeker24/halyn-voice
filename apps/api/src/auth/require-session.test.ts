import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionToken, testEnv } from '../../test/fixtures/api';
import type { AppEnv } from '../http/app-env';
import { onError } from '../http/errors';
import { requireSession } from './require-session';

const app = new Hono<AppEnv>();
app.onError(onError);
app.get('/any', requireSession(), (c) => c.json(c.get('session')));
app.get('/console-only', requireSession(['console']), (c) => c.json(c.get('session')));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requireSession', () => {
  it('puts the verified session on the context', async () => {
    const token = await sessionToken('customer');
    const res = await app.request('/any', { headers: { authorization: `Bearer ${token}` } }, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      tenant_id: 'ten_aero',
      kind: 'customer',
      customer_id: 'cus_saksham',
    });
  });

  it('rejects a missing, malformed, expired or wrong-kind token with 401', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const expired = await sessionToken('customer', 'cus_saksham', Date.now() - 13 * 3600 * 1000);
    const customer = await sessionToken('customer');
    for (const [path, header] of [
      ['/any', undefined],
      ['/any', 'Bearer'],
      ['/any', 'Basic abc'],
      ['/any', `Bearer ${expired}`],
      ['/console-only', `Bearer ${customer}`],
    ] as const) {
      const res = await app.request(path, header ? { headers: { authorization: header } } : {}, testEnv());
      expect(res.status, `${path} ${header}`).toBe(401);
    }
  });

  it('fails closed without a session secret', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const token = await sessionToken('console');
    const res = await app.request(
      '/console-only',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv({ SESSION_SECRET: undefined }),
    );
    expect(res.status).toBe(500);
  });
});
