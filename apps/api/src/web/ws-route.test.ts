import { ErrorEnvelopeSchema } from '@halyn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionToken, testEnv } from '../../test/fixtures/api';
import app from '../index';

// The success path (upgrade forwarded to the Hub, role tagging, broadcasts) is in test/int/ws.test.ts.

afterEach(() => {
  vi.restoreAllMocks();
});

async function ws(query: string, upgrade = true) {
  return app.request(`/ws${query}`, { headers: upgrade ? { upgrade: 'websocket' } : {} }, testEnv());
}

describe('GET /ws', () => {
  it('needs a WebSocket upgrade', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await ws(`?token=${await sessionToken('console')}&role=stage`, false);
    expect(res.status).toBe(400);
  });

  it('rejects a missing or bad session, a bad role and a role the session may not take', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const customer = await sessionToken('customer');
    const console_ = await sessionToken('console');
    for (const query of [
      '?role=stage',
      '?token=abc.def.ghi&role=stage',
      `?token=${console_}&role=admin`,
      `?token=${console_}`,
      `?token=${customer}&role=console`,
      `?token=${console_}&role=aero`,
    ]) {
      const res = await ws(query);
      expect(res.status, query).toBe(401);
      expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_UNAUTHORIZED');
    }
  });
});
