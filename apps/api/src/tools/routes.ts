import { Hono } from 'hono';
import { bolnaGuard } from '../auth/bolna-guard';
import type { AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { confirmResult } from './confirm';
import { getPassCode, lookupCustomer, verifyPass } from './identity';
import { checkDecision, proposeAction } from './propose';
import { bolnaWebhook } from './webhook';

/** /tools/* and /webhooks/* — Bolna only: source IP allowlist AND x-halyn-secret (bolnaGuard) before anything else. */
export function bolnaRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('/tools/*', bolnaGuard());
  app.use('/webhooks/*', bolnaGuard());
  app.post('/tools/lookup_customer', lookupCustomer(deps));
  app.post('/tools/verify_pass', verifyPass(deps));
  app.post('/tools/propose_action', proposeAction(deps));
  app.post('/tools/get_pass_code', getPassCode(deps));
  app.post('/tools/confirm_result', confirmResult(deps));
  app.post('/tools/check_decision', checkDecision(deps));
  app.post('/webhooks/bolna', bolnaWebhook(deps));
  return app;
}
