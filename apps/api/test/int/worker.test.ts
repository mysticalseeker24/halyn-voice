import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Through the real Worker entry point and its bindings (Miniflare).
describe('halyn-api worker', () => {
  it('serves /health', async () => {
    const res = await exports.default.fetch('https://api.halyn.test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'halyn-api' });
  });

  it('answers 404 for unknown routes', async () => {
    const res = await exports.default.fetch('https://api.halyn.test/nope');
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  it('has the CONFIG KV binding; no FILES R2 binding (files live in KV, ADR-023)', async () => {
    await env.CONFIG.put('probe', 'ok');
    expect(await env.CONFIG.get('probe')).toBe('ok');
    expect((env as unknown as Record<string, unknown>).FILES).toBeUndefined();
  });
});
