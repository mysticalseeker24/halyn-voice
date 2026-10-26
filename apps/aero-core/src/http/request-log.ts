import type { MiddlewareHandler } from 'hono';
import { logLine } from './errors';

/** One masked JSON line per request. Path only: never the query string, the body or the grant. */
export function requestLog(): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();
    await next();
    logLine({
      level: 'info',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  };
}
