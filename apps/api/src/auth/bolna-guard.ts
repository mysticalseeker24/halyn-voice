import { HalynError, timingSafeEqual } from '@halyn/shared';
import type { MiddlewareHandler } from 'hono';
import { requireEnv, ToolEnvSchema } from '../env';
import type { AppEnv } from '../http/app-env';

/**
 * /tools/* and /webhooks/*: Bolna has no HMAC, so the only trust is its fixed source IPs AND our shared secret
 * (docs/API.md, CLAUDE.md §3). Both checks always run, and a failure of either gets the same 401 body.
 */
export function bolnaGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { BOLNA_SOURCE_IPS, HALYN_TOOL_SECRET } = requireEnv(c.env, ToolEnvSchema);
    const ipOk = BOLNA_SOURCE_IPS.includes(c.req.header('cf-connecting-ip') ?? '');
    const secretOk = timingSafeEqual(c.req.header('x-halyn-secret') ?? '', HALYN_TOOL_SECRET);
    if (!(ipOk && secretOk)) throw new HalynError('E_UNAUTHORIZED', 'Unauthorized');
    await next();
  };
}
