import type { MiddlewareHandler } from 'hono';
import { logLine } from './errors';

/**
 * One structured JSON line per request, masked (phone and account numbers → last 4). Only the path is logged:
 * query strings can carry WebSocket tickets (/ws) and are never written.
 */
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
