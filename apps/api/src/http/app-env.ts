import type { Session } from '../auth/session';

/** Hono typing for the API Worker: bindings from wrangler.toml, plus the verified session on /web routes. */
export interface AppEnv {
  Bindings: Env;
  Variables: { session: Session };
}
