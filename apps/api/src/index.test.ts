import { ErrorEnvelopeSchema } from '@halyn/shared';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOLNA_IP, testEnv, TOOL_SECRET } from '../test/fixtures/api';
import app from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('halyn-api routes', () => {
  it('serves /health without any secret', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await app.request('/health', {}, {} as Env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'halyn-api' });
  });

  it('answers 404 E_NOT_FOUND for unknown routes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await app.request('/nope', {}, testEnv());
    expect(res.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_NOT_FOUND');
  });

  it('puts the tools and the webhook behind the Bolna guard', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const guarded = { 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET };
    for (const path of ['/tools/propose_action', '/webhooks/bolna']) {
      expect((await app.request(path, { method: 'POST' }, testEnv())).status, path).toBe(401);
      // Through the guard, the handler reads the body: none is a 400, not a 401.
      const res = await app.request(path, { method: 'POST', headers: guarded }, testEnv({ HUB: env.HUB }));
      expect(res.status, path).toBe(400);
      expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_BAD_REQUEST');
    }
  });
});
