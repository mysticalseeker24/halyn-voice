import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('HubDO', () => {
  it('is bound as HUB and answers 501 until Step 5', async () => {
    const res = await env.HUB.getByName('tenant_test').fetch('https://hub.internal/');
    expect(res.status).toBe(501);
    await res.body?.cancel();
  });
});
