import { ErrorEnvelopeSchema } from '@halyn/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_SECRET, sessionToken, testEnv } from '../../test/fixtures/api';
import { openTicket, sealTicket } from '../auth/ws-ticket';
import app from '../index';

// What /ws refuses before it asks any Hub (no HUB binding here). The ticket's success path, single use, expiry, role
// and tenant binding are in test/int/ws.test.ts against the real Hub.

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

async function ws(query: string, upgrade = true) {
  return app.request(`/ws${query}`, { headers: upgrade ? { upgrade: 'websocket' } : {} }, testEnv());
}

const SECRET_PART = 'A'.repeat(43);

describe('GET /ws', () => {
  it('needs a WebSocket upgrade', async () => {
    const ticket = await sealTicket(`ten_aero.${SECRET_PART}`, SESSION_SECRET);
    const res = await ws(`?ticket=${ticket}&role=stage`, false);
    expect(res.status).toBe(400);
  });

  it('refuses a session token (alone or next to a ticket), a missing, malformed or forged ticket, and a bad role', async () => {
    const session = await sessionToken('console');
    const good = await sealTicket(`ten_aero.${SECRET_PART}`, SESSION_SECRET);
    const forged = await sealTicket(`ten_aero.${SECRET_PART}`, `${SESSION_SECRET}x`);
    const [, , mac] = good.split('.');
    for (const query of [
      `?token=${session}&role=stage`,
      `?token=&role=stage`,
      `?ticket=${good}&token=${session}&role=stage`,
      '?role=stage',
      '?ticket=&role=stage',
      '?ticket=abc.def.ghi&role=stage',
      `?ticket=${forged}&role=stage`,
      `?ticket=ten_other.${SECRET_PART}.${mac}&role=stage`,
      `?ticket=${good}x&role=stage`,
      `?ticket=${good}&role=admin`,
      `?ticket=${good}`,
    ]) {
      const res = await ws(query);
      expect(res.status, query).toBe(401);
      expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_UNAUTHORIZED');
    }
  });
});

describe('ticket seal (auth/ws-ticket.ts)', () => {
  it('opens only what it sealed, with the same secret, and names the tenant', async () => {
    const body = `ten_aero.${SECRET_PART}`;
    const ticket = await sealTicket(body, SESSION_SECRET);
    expect(await openTicket(ticket, SESSION_SECRET)).toEqual({ tenant: 'ten_aero', body });
    expect(await openTicket(ticket, `${SESSION_SECRET}x`)).toBeNull();
    for (const bad of [undefined, 42, '', `${ticket}.x`, ticket.toUpperCase(), 'x'.repeat(4096)])
      expect(await openTicket(bad, SESSION_SECRET)).toBeNull();
    await expect(sealTicket('not a ticket body', SESSION_SECRET)).rejects.toMatchObject({
      code: 'E_FAIL_CLOSED',
    });
  });
});
