import { HalynError, HubRoleSchema, WsTicketRequestSchema, WsTicketResponseSchema } from '@halyn/shared';
import type { Context } from 'hono';
import { openTicket, roleAllowed, sealTicket } from '../auth/ws-ticket';
import { requireEnv, SessionEnvSchema } from '../env';
import type { AppEnv } from '../http/app-env';
import { hubFor } from '../hub/client';
import { readJson } from './session-route';

// The apps' WebSocket to the tenant Hub (ADR-021). A browser cannot set headers on a WebSocket, and a URL may be kept
// by edge logs, so the session token never goes in one: the app trades it for a one-time ticket, then opens the socket.

/**
 * POST /web/ws-ticket `{role}` (session) → `{ticket, expires_at}`: one socket, for that role, within 30 s. The role
 * must be one the session may take (customer: aero/assistant; console: stage/console); else 401.
 */
export async function wsTicket(c: Context<AppEnv>): Promise<Response> {
  const session = c.get('session');
  const { role } = WsTicketRequestSchema.parse(await readJson(c));
  if (!roleAllowed(session.kind, role))
    throw new HalynError('E_UNAUTHORIZED', 'This session may not listen as that role');
  const { SESSION_SECRET } = requireEnv(c.env, SessionEnvSchema);
  const { body, expires_at } = await hubFor(c.env, session.tenant_id).issueWsTicket({
    kind: session.kind,
    customer_id: session.customer_id,
    role,
  });
  c.header('cache-control', 'no-store');
  return c.json(WsTicketResponseSchema.parse({ ticket: await sealTicket(body, SESSION_SECRET), expires_at }));
}

const refused = () => new HalynError('E_UNAUTHORIZED', 'A valid WebSocket ticket and role are required');

/**
 * GET /ws?ticket=<ticket>&role=<role>: the ticket's seal names the tenant; that tenant's Hub uses the ticket up and
 * opens the socket. A session token in the query (`?token=`) is refused, never silently accepted or ignored.
 */
export async function connectWebSocket(c: Context<AppEnv>): Promise<Response> {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
    throw new HalynError('E_BAD_REQUEST', 'Expected a WebSocket upgrade');
  const query = new URL(c.req.url).searchParams;
  if (query.has('token'))
    throw new HalynError('E_UNAUTHORIZED', 'Session tokens are not accepted here; use a WebSocket ticket');
  const { SESSION_SECRET } = requireEnv(c.env, SessionEnvSchema);
  const ticket = await openTicket(query.get('ticket'), SESSION_SECRET);
  const role = HubRoleSchema.safeParse(query.get('role'));
  if (!ticket || !role.success) throw refused();
  const res = await c.env.HUB.getByName(ticket.tenant).fetch(
    new Request('https://hub.internal/ws', {
      headers: {
        Upgrade: 'websocket',
        'x-halyn-role': role.data,
        'x-halyn-tenant': ticket.tenant,
        'x-halyn-ticket': ticket.body,
      },
    }),
  );
  if (res.status !== 101) {
    await res.body?.cancel();
    throw refused();
  }
  return res;
}
