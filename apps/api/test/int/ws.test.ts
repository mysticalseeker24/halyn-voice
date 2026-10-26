import { WsMessageSchema } from '@halyn/shared';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { hubFor } from '../../src/hub/client';
import { sessionToken, uniqueTenant } from '../fixtures/api';

// GET /ws through the real Worker: session check, forward to the tenant's Hub, role tags, broadcasts.

async function open(tenant: string, kind: 'customer' | 'console', role: string) {
  const token = await sessionToken(kind, undefined, Date.now(), tenant);
  const res = await exports.default.fetch(`https://api.halyn.test/ws?token=${token}&role=${role}`, {
    headers: { upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('no WebSocket in the 101 response');
  ws.accept();
  const messages: unknown[] = [];
  ws.addEventListener('message', (event) => {
    messages.push(event.data === 'pong' ? 'pong' : JSON.parse(String(event.data)));
  });
  return { ws, messages };
}

async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for a WebSocket message');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Hub WebSockets', () => {
  it('tags sockets by role and delivers each broadcast only to the roles it targets', async () => {
    const tenant = uniqueTenant();
    const hub = hubFor(env, tenant);
    const stage = await open(tenant, 'console', 'stage');
    const aero = await open(tenant, 'customer', 'aero');
    expect(await hub.sockets()).toEqual({ stage: 1, console: 0, aero: 1, assistant: 0 });

    // A ledger append goes to the Stage and Console only.
    const entry = await hub.appendLedger({ type: 'proposed', ref_id: 'req_1', payload: {} });
    await until(() => stage.messages.length === 1);
    expect(WsMessageSchema.parse(stage.messages[0])).toMatchObject({
      type: 'ledger_append',
      seq: 1,
      hash: entry.hash,
    });

    // A confirmation prompt reaches the Aero app; its timeout or answer reaches everyone.
    await hub.startConfirmation({
      request_id: 'req_1',
      channels: ['passkey'],
      timeout_seconds: 60,
      prompt: {
        action: 'transfer.new_payee',
        summary: 'Send ₹45,000 to account ending 4471',
        amount: { amount_minor: 4500000, currency: 'INR' },
      },
    });
    await hub.resolveConfirmation({ request_id: 'req_1', answer: 'declined', channel: 'passkey' });
    await until(() => aero.messages.some((m) => (m as { type: string }).type === 'confirm_resolved'));
    const aeroTypes = aero.messages.map((m) => WsMessageSchema.parse(m).type);
    expect(aeroTypes).toEqual(['confirm_request', 'confirm_resolved']);
    await until(() => stage.messages.some((m) => (m as { type: string }).type === 'confirm_resolved'));

    // Apps only listen; a ping is answered so idle sockets stay open.
    aero.ws.send('ping');
    await until(() => aero.messages.includes('pong'));

    stage.ws.close(1000, 'bye');
    aero.ws.close(1000, 'bye');
  });
});
