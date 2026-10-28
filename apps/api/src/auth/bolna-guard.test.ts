import { ErrorEnvelopeSchema } from '@halyn/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOLNA_IP, testEnv, TOOL_SECRET } from '../../test/fixtures/api';
import type { AppEnv } from '../http/app-env';
import { onError } from '../http/errors';
import { bolnaGuard } from './bolna-guard';

const app = new Hono<AppEnv>();
app.onError(onError);
app.use('/tools/*', bolnaGuard());
app.post('/tools/probe', (c) => c.json({ ok: true }));

function call(headers: Record<string, string>, env = testEnv()) {
  return app.request('/tools/probe', { method: 'POST', headers }, env);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bolnaGuard', () => {
  it('lets a Bolna source IP with the right secret through', async () => {
    const res = await call({ 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each([
    ['a wrong IP', { 'cf-connecting-ip': '203.0.113.7', 'x-halyn-secret': TOOL_SECRET }],
    ['no IP', { 'x-halyn-secret': TOOL_SECRET }],
    ['a missing secret', { 'cf-connecting-ip': BOLNA_IP }],
    ['a wrong secret', { 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': `${TOOL_SECRET.slice(0, -1)}x` }],
    ['a prefix of the secret', { 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET.slice(0, 10) }],
    ['neither', {}],
  ])('rejects %s with the same 401 body', async (_, headers) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await call(headers);
    expect(res.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await res.json())).toEqual({
      error: { code: 'E_UNAUTHORIZED', message: 'Unauthorized' },
    });
  });

  it('fails closed (500) when the guard is not configured', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await call(
      { 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET },
      testEnv({ HALYN_TOOL_SECRET: undefined }),
    );
    expect(res.status).toBe(500);
    expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_FAIL_CLOSED');
  });
});

describe('bolnaGuard on webhooks (secret in ?key=, ADR-022)', () => {
  const hooks = new Hono<AppEnv>();
  hooks.onError(onError);
  hooks.use('/webhooks/*', bolnaGuard({ querySecret: true }));
  hooks.post('/webhooks/bolna', (c) => c.json({ ok: true }));
  const post = (path: string, headers: Record<string, string>) =>
    hooks.request(path, { method: 'POST', headers }, testEnv());

  it('accepts the secret as ?key= from a Bolna IP', async () => {
    const res = await post(`/webhooks/bolna?key=${TOOL_SECRET}`, { 'cf-connecting-ip': BOLNA_IP });
    expect(res.status).toBe(200);
  });

  it('still needs the Bolna IP and the exact secret', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect((await post(`/webhooks/bolna?key=${TOOL_SECRET}`, { 'cf-connecting-ip': '203.0.113.7' })).status).toBe(401);
    expect((await post(`/webhooks/bolna?key=${TOOL_SECRET.slice(0, 10)}`, { 'cf-connecting-ip': BOLNA_IP })).status).toBe(
      401,
    );
    expect((await post('/webhooks/bolna', { 'cf-connecting-ip': BOLNA_IP })).status).toBe(401);
  });

  it('never takes ?key= on /tools/*', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await app.request(`/tools/probe?key=${TOOL_SECRET}`, {
      method: 'POST',
      headers: { 'cf-connecting-ip': BOLNA_IP },
    }, testEnv());
    expect(res.status).toBe(401);
  });
});
