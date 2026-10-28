import {
  CheckDecisionRequestSchema,
  CheckDecisionResponseSchema,
  HalynError,
  paramsHash,
  ProposeActionRequestSchema,
  ProposeActionResponseSchema,
} from '@halyn/shared';
import type { Context } from 'hono';
import { callbackAvailability } from '../confirm/start';
import { registeredNumberHash } from '../db/numbers';
import { PhoneEnvSchema } from '../env';
import type { AppDeps } from '../flow/context';
import { dispatchProposal } from '../flow/dispatch';
import type { AppEnv } from '../http/app-env';
import { loadPacks } from '../packs/load';
import { scoreCoaching } from '../signals/coaching-lexicon';
import { detectDistress } from '../signals/distress-lexicon';
import { readToolBody, toolContext } from './common';

// propose_action (docs/ARCHITECTURE.md "Main flow"): answer `{request_id, status: "pending"}` within 300 ms; the
// outcome reaches the call as an event. The hot path is: normalise → hash the raw params → keyword signals (pure) →
// compiled packs (KV, cached per isolate) → ONE Hub RPC that de-duplicates on (run_id, params_hash), runs the real
// Gate on the Hub's own rows and records request, decision and ledger entries in order. No TiDB here: the Hub mirrors
// to TiDB from its outbox (ADR-016). Everything slow (events, the Confirm call, grant + Aero Core) runs in waitUntil.
// An unknown action or bad params is a recorded `deny E_FAIL_CLOSED`, never an HTTP 400 (ADR-010).

/** POST /tools/propose_action. */
export function proposeAction(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const ctx = toolContext(c, deps);
    const { body, raw } = await readToolBody(c, 'propose_action', ProposeActionRequestSchema, ctx);
    // The RAW params (not Zod's record output, which drops an own "__proto__"): the Gate's strict schema decides.
    const params = raw.params;
    let params_json: string;
    let params_hash: string;
    try {
      params_json = JSON.stringify(params);
      params_hash = await paramsHash(params);
    } catch {
      throw new HalynError('E_BAD_REQUEST', 'Invalid propose_action params');
    }
    const phone = PhoneEnvSchema.safeParse(c.env);
    const [packs, callback, number_hash] = await Promise.all([
      loadPacks(c.env.CONFIG, ctx.tenant),
      callbackAvailability(ctx.flow),
      body.from_number && phone.success
        ? registeredNumberHash(phone.data.PHONE_HASH_PEPPER, body.from_number)
        : Promise.resolve(null),
    ]);
    const coaching = scoreCoaching(body.caller_quotes);
    const outcome = await ctx.flow.hub.propose({
      run_id: body.run_id,
      call_sid: body.call_sid ?? null,
      channel: body.channel,
      from_number: body.from_number ?? null,
      number_hash,
      default_region: ctx.region,
      action: body.action,
      params_json,
      params_hash,
      readback_confirmed: body.readback_confirmed,
      caller_quotes: body.caller_quotes,
      coaching: { score: coaching.score, cues: coaching.cues },
      distress: detectDistress(body.caller_quotes).distress,
      packs,
      callback,
    });
    c.executionCtx.waitUntil(dispatchProposal(ctx.flow, outcome));
    return c.json(
      ProposeActionResponseSchema.parse({ request_id: outcome.record.request_id, status: 'pending' }),
    );
  };
}

/** POST /tools/check_decision: the event the call would have received (fallback when event injection fails). */
export function checkDecision(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const ctx = toolContext(c, deps);
    const { body } = await readToolBody(c, 'check_decision', CheckDecisionRequestSchema, ctx);
    const record = await ctx.flow.hub.requestState(body.request_id);
    // A request is only visible to the call that made it.
    if (!record || record.run_id !== body.run_id) throw new HalynError('E_NOT_FOUND', 'No such request');
    return c.json(
      CheckDecisionResponseSchema.parse(
        record.last_event
          ? { request_id: record.request_id, status: 'decided', event: record.last_event }
          : { request_id: record.request_id, status: 'pending' },
      ),
    );
  };
}
