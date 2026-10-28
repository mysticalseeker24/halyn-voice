import { HalynError, timingSafeEqual } from '@halyn/shared';
import type { MiddlewareHandler } from 'hono';
import { requireEnv, ToolEnvSchema } from '../env';
import type { AppEnv } from '../http/app-env';

/**
 * /tools/* and /webhooks/*: Bolna has no HMAC, so the only trust is its fixed source IPs AND our shared secret
 * (docs/API.md, CLAUDE.md §3). Both checks always run, and a failure of either gets the same 401 body.
 * Tools send the secret in the `x-halyn-secret` header. Bolna's agent `webhook_url` and a tool's
 * `pre_call_webhook_url` cannot carry headers, so on /webhooks/* (`querySecret`) the secret may instead come as
 * `?key=` (ADR-022); the request log records the path only, never the query.
 */
export function bolnaGuard(options: { querySecret?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { BOLNA_SOURCE_IPS, HALYN_TOOL_SECRET } = requireEnv(c.env, ToolEnvSchema);
    const ipOk = BOLNA_SOURCE_IPS.includes(c.req.header('cf-connecting-ip') ?? '');
    const given =
      c.req.header('x-halyn-secret') ?? (options.querySecret ? c.req.query('key') : undefined) ?? '';
    const secretOk = timingSafeEqual(given, HALYN_TOOL_SECRET);
    if (!(ipOk && secretOk)) throw new HalynError('E_UNAUTHORIZED', 'Unauthorized');
    await next();
  };
}
