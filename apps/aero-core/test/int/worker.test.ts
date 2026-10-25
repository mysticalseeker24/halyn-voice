import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Through the real Worker entry point and its D1 binding (Miniflare).
describe('aero-core worker', () => {
  it('serves /health', async () => {
    const res = await exports.default.fetch('https://core.aero.test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'aero-core' });
  });

  it('has the DB (D1) binding', async () => {
    const row = await env.DB.prepare('select 1 as one').first<{ one: number }>();
    expect(row).toEqual({ one: 1 });
  });
});
