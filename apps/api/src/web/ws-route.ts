import { HalynError, type HubRole, HubRoleSchema } from '@halyn/shared';
import type { Context } from 'hono';
import { type SessionKind, verifySession } from '../auth/session';
import { requireEnv, SessionEnvSchema } from '../env';
import type { AppEnv } from '../http/app-env';

/** Which Hub roles each kind of session may listen as. */
const ROLES: Record<SessionKind, readonly HubRole[]> = {
  customer: ['aero', 'assistant'],
  console: ['stage', 'console'],
};

/**
 * GET /ws?token=<session>&role=<role>: a browser can't set headers on a WebSocket, so the session comes as a query
 * parameter (never logged). The tenant comes from the token, and the upgrade is forwarded to that tenant's Hub.
 */
export async function connectWebSocket(c: Context<AppEnv>): Promise<Response> {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
    throw new HalynError('E_BAD_REQUEST', 'Expected a WebSocket upgrade');
  const { SESSION_SECRET } = requireEnv(c.env, SessionEnvSchema);
  const session = await verifySession(c.req.query('token'), SESSION_SECRET, Date.now());
  const role = HubRoleSchema.safeParse(c.req.query('role'));
  if (!session || !role.success || !ROLES[session.kind].includes(role.data))
    throw new HalynError('E_UNAUTHORIZED', 'A valid session and role are required');
  const hub = c.env.HUB.getByName(session.tenant_id);
  return hub.fetch(
    new Request('https://hub.internal/ws', {
      headers: { Upgrade: 'websocket', 'x-halyn-role': role.data, 'x-halyn-tenant': session.tenant_id },
    }),
  );
}
