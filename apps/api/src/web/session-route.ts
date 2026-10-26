import { HalynError, SessionRequestSchema, SessionResponseSchema, timingSafeEqual } from '@halyn/shared';
import type { Context } from 'hono';
import { signSession } from '../auth/session';
import { requireEnv, SessionEnvSchema } from '../env';
import type { AppEnv } from '../http/app-env';

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HalynError('E_BAD_REQUEST', 'The body must be JSON');
  }
}

/**
 * POST /web/session — demo login for a customer or a console user (docs/API.md). The tenant is the deployment's
 * default tenant; when DEMO_ACCESS_CODE is set, the caller must also send it as `x-demo-code`.
 */
export async function createSession(c: Context<AppEnv>): Promise<Response> {
  const env = requireEnv(c.env, SessionEnvSchema);
  if (
    env.DEMO_ACCESS_CODE !== undefined &&
    !timingSafeEqual(c.req.header('x-demo-code') ?? '', env.DEMO_ACCESS_CODE)
  )
    throw new HalynError('E_UNAUTHORIZED', 'A valid demo access code is required');
  const body = SessionRequestSchema.parse(await readJson(c));
  const { token, session } = await signSession(
    {
      tenant_id: env.DEFAULT_TENANT_ID,
      kind: body.kind,
      customer_id: body.kind === 'customer' ? body.customer_id : null,
    },
    env.SESSION_SECRET,
    Date.now(),
  );
  return c.json(SessionResponseSchema.parse({ token, ...session }));
}
