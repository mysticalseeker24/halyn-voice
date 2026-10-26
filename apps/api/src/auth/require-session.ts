import { HalynError } from '@halyn/shared';
import type { MiddlewareHandler } from 'hono';
import { requireEnv, SessionEnvSchema } from '../env';
import type { AppEnv } from '../http/app-env';
import { type SessionKind, verifySession } from './session';

const BEARER = /^Bearer ([A-Za-z0-9_.-]+)$/;

/** /web/*: a valid `Authorization: Bearer <session>` (optionally of the given kinds), else 401 E_UNAUTHORIZED. */
export function requireSession(kinds?: readonly SessionKind[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { SESSION_SECRET } = requireEnv(c.env, SessionEnvSchema);
    const match = BEARER.exec(c.req.header('authorization') ?? '');
    const session = match ? await verifySession(match[1], SESSION_SECRET, Date.now()) : null;
    if (!session || (kinds && !kinds.includes(session.kind)))
      throw new HalynError('E_UNAUTHORIZED', 'A valid session is required');
    c.set('session', session);
    await next();
  };
}
