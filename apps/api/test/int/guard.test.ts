import { ErrorEnvelopeSchema } from '@halyn/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { BOLNA_IP, TOOL_SECRET } from '../fixtures/api';

// Through the real Worker entry point with the wrangler.toml vars and the test secrets (vitest.config.ts).
async function tool(headers: Record<string, string>, path = '/tools/propose_action') {
  return exports.default.fetch(`https://api.halyn.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  });
}

describe('bolnaGuard on the deployed routes', () => {
  it.each([
    ['a wrong IP', { 'cf-connecting-ip': '198.51.100.1', 'x-halyn-secret': TOOL_SECRET }],
    ['a missing secret', { 'cf-connecting-ip': BOLNA_IP }],
    ['a wrong secret', { 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': 'x'.repeat(TOOL_SECRET.length) }],
    ['no credentials at all', {}],
  ])('rejects %s with 401 E_UNAUTHORIZED', async (_, headers) => {
    for (const path of ['/tools/propose_action', '/tools/lookup_customer', '/webhooks/bolna']) {
      const res = await tool(headers, path);
      expect(res.status, path).toBe(401);
      expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_UNAUTHORIZED');
    }
  });

  it('lets the Bolna IP with the secret through to the tool (which refuses an empty body with 400)', async () => {
    const res = await tool({ 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET });
    expect(res.status).toBe(400);
    await res.body?.cancel();
  });
});
