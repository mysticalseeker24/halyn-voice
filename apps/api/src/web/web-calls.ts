import { HalynError, WebCallSessionRequestSchema, WebCallSessionSchema } from '@halyn/shared';
import type { Context } from 'hono';
import { WebCallEnvSchema } from '../env';
import { type AppDeps, flowContext } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { customer } from './passkeys';
import { readJson } from './session-route';

// "Call Aero" in the browser (docs/BOLNA.md "Web calls", scenario 10). The API mints the single-use Web Call SDK
// session with its own Bolna key and, before the browser gets it, registers the session's run id in the Hub as the
// signed-in customer's call (channel web, proof app_session). The region — the request's, else the Stage's — picks
// the agent: Hindi graph for IN, English web-only graph for US. Never a phone call, so no US number is ever dialled.

/** POST /web/calls/session `{region?}` → Bolna's session object, as `@bolna/web-call` expects it. */
export function webCallSession(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const flow = flowContext(c.env, tenant, deps);
    const body = WebCallSessionRequestSchema.parse(await readJson(c));
    const region = body.region ?? (await flow.hub.stageRegion());
    const agents = WebCallEnvSchema.parse(c.env);
    const agent_id = region === 'US' ? agents.BOLNA_AERO_EN_AGENT_ID : agents.BOLNA_AERO_AGENT_ID;
    if (!agent_id) throw new HalynError('E_NOT_FOUND', `No Aero web agent for ${region}`);
    if (!flow.bolna) throw new HalynError('E_FAIL_CLOSED', 'Bolna is not configured');
    const who = await flow.hub.webCallCustomer(customer_id, region);
    const session = await flow.bolna.mintWebCall({
      agent_id,
      // The spoken form (Devanagari for Saksham): Sarvam reads Roman "Saksham" wrong (CLAUDE.md §8).
      user_data: { customer_name: who.spoken_name, region },
    });
    await flow.hub.registerWebCall({ run_id: session.run_id, session_customer_id: customer_id, region });
    return c.json(WebCallSessionSchema.parse(session));
  };
}
