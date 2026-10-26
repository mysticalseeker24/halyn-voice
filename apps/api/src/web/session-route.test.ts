import { ErrorEnvelopeSchema, SessionResponseSchema } from '@halyn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_SECRET, testEnv } from '../../test/fixtures/api';
import { verifySession } from '../auth/session';
import app from '../index';

function post(body: unknown, headers: Record<string, string> = {}, env = testEnv()) {
  return app.request(
    '/web/session',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /web/session', () => {
  it('issues a customer session for the default tenant that /web/me accepts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await post({ kind: 'customer', customer_id: 'cus_saksham' });
    expect(res.status).toBe(200);
    const body = SessionResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ tenant_id: 'ten_aero', kind: 'customer', customer_id: 'cus_saksham' });
    expect(await verifySession(body.token, SESSION_SECRET, Date.now())).not.toBeNull();
    const me = await app.request(
      '/web/me',
      { headers: { authorization: `Bearer ${body.token}` } },
      testEnv(),
    );
    expect(await me.json()).toMatchObject({ kind: 'customer', customer_id: 'cus_saksham' });
  });

  it('issues a console session', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const body = SessionResponseSchema.parse(await (await post({ kind: 'console' })).json());
    expect(body.customer_id).toBeNull();
  });

  it('rejects bad JSON, a bad body and a tenant in the body with 400', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    for (const body of [
      '{not json',
      { kind: 'admin' },
      { kind: 'customer' },
      { kind: 'console', tenant_id: 'ten_other' },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_BAD_REQUEST');
    }
  });

  it('requires the demo access code when one is configured', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const env = testEnv({ DEMO_ACCESS_CODE: 'aero-demo-2026' });
    expect((await post({ kind: 'console' }, {}, env)).status).toBe(401);
    expect((await post({ kind: 'console' }, { 'x-demo-code': 'wrong-code-0' }, env)).status).toBe(401);
    expect((await post({ kind: 'console' }, { 'x-demo-code': 'aero-demo-2026' }, env)).status).toBe(200);
  });

  it('keeps every other /web route behind a session', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect((await app.request('/web/me', {}, testEnv())).status).toBe(401);
  });
});
