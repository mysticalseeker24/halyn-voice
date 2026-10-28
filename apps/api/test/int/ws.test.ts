import { ErrorEnvelopeSchema, WsMessageSchema, WsTicketResponseSchema } from '@halyn/shared';
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubFor } from '../../src/hub/client';
import type { HubDO } from '../../src/hub/hub-do';
import { sessionToken, uniqueTenant } from '../fixtures/api';
import { movableClock } from '../fixtures/hub';

// GET /ws through the real Worker: a one-time ticket (POST /web/ws-ticket with the session), then the upgrade with the
// ticket — never the session itself in a URL (ADR-021) — forwarded to the tenant's Hub, role tags, broadcasts.

const API = 'https://api.halyn.test';
const ORIGIN = 'http://localhost:3000';

afterEach(() => vi.restoreAllMocks());

async function askTicket(session: string, role: string): Promise<Response> {
  return exports.default.fetch(`${API}/web/ws-ticket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ role }),
  });
}

async function ticketFor(tenant: string, kind: 'customer' | 'console', role: string) {
  const session = await sessionToken(kind, undefined, Date.now(), tenant);
  const res = await askTicket(session, role);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  return { session, ...WsTicketResponseSchema.parse(await res.json()) };
}

function connect(query: string): Promise<Response> {
  return exports.default.fetch(`${API}/ws${query}`, { headers: { upgrade: 'websocket' } });
}

async function refused(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  expect(res.webSocket).toBeNull();
  expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe('E_UNAUTHORIZED');
}

async function open(tenant: string, kind: 'customer' | 'console', role: string) {
  const { ticket } = await ticketFor(tenant, kind, role);
  const res = await connect(`?ticket=${encodeURIComponent(ticket)}&role=${role}`);
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

describe('WebSocket tickets (ADR-021)', () => {
  it('a ticket opens exactly one socket: the second use is refused', async () => {
    const tenant = uniqueTenant();
    const { ticket, expires_at } = await ticketFor(tenant, 'console', 'stage');
    const query = `?ticket=${encodeURIComponent(ticket)}&role=stage`;
    const first = await connect(query);
    expect(first.status).toBe(101);
    first.webSocket?.accept();
    await refused(await connect(query));
    expect(await hubFor(env, tenant).sockets()).toMatchObject({ stage: 1 });
    // ≥ 128 random bits, and it lives at most 30 s.
    expect(ticket.length).toBeGreaterThanOrEqual(43);
    expect(Date.parse(expires_at) - Date.now()).toBeLessThanOrEqual(30_000);
    first.webSocket?.close(1000, 'bye');
  });

  it('an expired ticket (older than 30 s) is refused', async () => {
    const tenant = uniqueTenant();
    const clock = movableClock(Date.now());
    // The Hub owns the ticket's clock: issue and expiry are both read from it.
    await runInDurableObject(env.HUB.getByName(tenant), (hub: HubDO) => {
      hub.clock = clock;
    });
    const { ticket, expires_at } = await ticketFor(tenant, 'customer', 'aero');
    expect(Date.parse(expires_at)).toBe(clock.nowMs() + 30_000);
    clock.advance(30_000);
    await refused(await connect(`?ticket=${encodeURIComponent(ticket)}&role=aero`));
    expect(await hubFor(env, tenant).sockets()).toMatchObject({ aero: 0 });
  });

  it("another tenant's ticket is refused, whether presented as issued or re-labelled", async () => {
    const mine = uniqueTenant();
    const theirs = uniqueTenant();
    await hubFor(env, mine).ledgerHead();
    const { ticket } = await ticketFor(theirs, 'console', 'stage');
    const [, secret, mac] = ticket.split('.');
    // Re-labelled to my tenant: the seal no longer matches, so no Hub is even asked.
    await refused(await connect(`?ticket=${encodeURIComponent(`${mine}.${secret}.${mac}`)}&role=stage`));
    // As issued, it can only ever open a socket on its own tenant's Hub — never mine.
    const res = await connect(`?ticket=${encodeURIComponent(ticket)}&role=stage`);
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    expect(await hubFor(env, mine).sockets()).toEqual({ stage: 0, console: 0, aero: 0, assistant: 0 });
    expect(await hubFor(env, theirs).sockets()).toMatchObject({ stage: 1 });
    res.webSocket?.close(1000, 'bye');
  });

  it('a ticket presented for another role is refused, and burned', async () => {
    const tenant = uniqueTenant();
    const { ticket } = await ticketFor(tenant, 'console', 'stage');
    await refused(await connect(`?ticket=${encodeURIComponent(ticket)}&role=console`));
    await refused(await connect(`?ticket=${encodeURIComponent(ticket)}&role=stage`));
  });

  it('a ticket is issued only for a role the session may take, and only with a session', async () => {
    const tenant = uniqueTenant();
    const customer = await sessionToken('customer', undefined, Date.now(), tenant);
    const console_ = await sessionToken('console', undefined, Date.now(), tenant);
    expect((await askTicket(customer, 'stage')).status).toBe(401);
    expect((await askTicket(customer, 'console')).status).toBe(401);
    expect((await askTicket(console_, 'aero')).status).toBe(401);
    expect((await askTicket(console_, 'admin')).status).toBe(400);
    expect((await askTicket('not-a-session', 'stage')).status).toBe(401);
    expect((await askTicket(customer, 'assistant')).status).toBe(200);
  });

  it('the session token is never accepted on /ws, alone or next to a ticket', async () => {
    const tenant = uniqueTenant();
    const { session, ticket } = await ticketFor(tenant, 'console', 'stage');
    await refused(await connect(`?token=${session}&role=stage`));
    await refused(await connect(`?ticket=${encodeURIComponent(ticket)}&token=${session}&role=stage`));
    expect(await hubFor(env, tenant).sockets()).toMatchObject({ stage: 0 });
  });

  it('neither the session token nor the ticket appears in any log line', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(
      (...line: unknown[]) => void logs.push(line.map(String).join(' ')),
    );
    const tenant = uniqueTenant();
    const { session, ticket } = await ticketFor(tenant, 'console', 'stage');
    const ok = await connect(`?ticket=${encodeURIComponent(ticket)}&role=stage`);
    ok.webSocket?.accept();
    await connect(`?ticket=${encodeURIComponent(ticket)}&role=stage`);
    await connect(`?token=${session}&role=stage`);
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    const [, secret, mac] = ticket.split('.');
    for (const secretPart of [session, ticket, secret as string, mac as string])
      expect(all).not.toContain(secretPart);
    ok.webSocket?.close(1000, 'bye');
  });
});
