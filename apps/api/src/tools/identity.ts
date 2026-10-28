import {
  GetPassCodeRequestSchema,
  GetPassCodeResponseSchema,
  HalynError,
  importVerifyKeys,
  LookupCustomerRequestSchema,
  LookupCustomerResponseSchema,
  VerifyPassRequestSchema,
  VerifyPassResponseSchema,
} from '@halyn/shared';
import type { Context } from 'hono';
import { registeredNumberHash } from '../db/numbers';
import { AssistantEnvSchema, JwksEnvSchema, PhoneEnvSchema, requireEnv } from '../env';
import type { AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { verifyPassToken } from '../pass';
import { readToolBody, toolContext } from './common';

// Who is calling (docs/API.md "Bolna-facing tools"): lookup_customer (registered number, or a claimed name that is
// never proof), verify_pass (an assistant's spoken one-time code, docs/PASS.md) and get_pass_code (the assistant
// trades its Pass token for a code). All answer from the tenant's Hub (ADR-016): no TiDB on these paths.

const keyCache = new Map<string, Promise<ReadonlyMap<string, CryptoKey>>>();

function verifyKeys(jwks: string): Promise<ReadonlyMap<string, CryptoKey>> {
  let keys = keyCache.get(jwks);
  if (!keys) {
    keys = importVerifyKeys(jwks);
    keys.catch(() => keyCache.delete(jwks));
    keyCache.set(jwks, keys);
  }
  return keys;
}

/** POST /tools/lookup_customer → `{customer_found, customer_name?, region?, registered, language?}`. */
export function lookupCustomer(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const ctx = toolContext(c, deps);
    const { body } = await readToolBody(c, 'lookup_customer', LookupCustomerRequestSchema, ctx);
    const { PHONE_HASH_PEPPER } = requireEnv(c.env, PhoneEnvSchema);
    const { customer, call } = await ctx.flow.hub.identifyCaller({
      run_id: body.run_id,
      call_sid: body.call_sid ?? null,
      channel: 'phone',
      region: ctx.region,
      number_hash: await registeredNumberHash(PHONE_HASH_PEPPER, body.from_number),
      from_last4: body.from_number.slice(-4),
      claimed_name: body.claimed_name ?? null,
    });
    return c.json(
      LookupCustomerResponseSchema.parse(
        customer
          ? {
              customer_found: true,
              // The spoken form: voices must never say Roman "Saksham" (CLAUDE.md §8). Screens use the Roman name.
              customer_name: customer.spoken_name,
              region: customer.region,
              registered: call.registered,
              language: customer.language,
            }
          : { customer_found: false, registered: false },
      ),
    );
  };
}

/** POST /tools/verify_pass → `{valid, assistant_name?, scopes_summary?}`; never echoes the code or says why it failed. */
export function verifyPass(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const ctx = toolContext(c, deps);
    const { body } = await readToolBody(c, 'verify_pass', VerifyPassRequestSchema, ctx);
    const result = await ctx.flow.hub.verifyPassCode({
      run_id: body.run_id,
      call_sid: body.call_sid ?? null,
      from_number: body.from_number,
      code: body.code,
      region: ctx.region,
    });
    return c.json(
      VerifyPassResponseSchema.parse(
        result.valid
          ? { valid: true, assistant_name: result.assistant_name, scopes_summary: result.scopes.join(', ') }
          : { valid: false },
      ),
    );
  };
}

/**
 * POST /tools/get_pass_code (the Assistant agent) → `{code}`: 6 digits, 5 minutes, single use, bound to its number.
 * With a Pass token, the token decides the Pass. Without one, only the Assistant call Halyn itself placed for a Pass
 * (POST /web/assistant/tasks) gets a code for that Pass — the LLM never has to copy a token.
 */
export function getPassCode(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const ctx = toolContext(c, deps);
    const { body } = await readToolBody(c, 'get_pass_code', GetPassCodeRequestSchema, ctx);
    const refused = () => new HalynError('E_BAD_REQUEST', 'This Pass cannot be used now');
    let pass_id: string;
    let numbers: readonly string[] | null = null;
    if (body.pass_token) {
      const { HALYN_PUBLIC_JWKS } = requireEnv(c.env, JwksEnvSchema);
      const token = await verifyPassToken(
        body.pass_token,
        await verifyKeys(HALYN_PUBLIC_JWKS),
        ctx.flow.clock.nowMs(),
      );
      if (!token.ok || token.claims.tenant !== ctx.tenant) throw refused();
      pass_id = token.claims.pid;
      numbers = token.claims.assistant.numbers;
    } else {
      const bound = await ctx.flow.hub.assistantCallPass(body.run_id);
      if (!bound) throw refused();
      pass_id = bound;
      // Halyn placed this call from number B itself: that is the calling number Aero will see.
      numbers = [requireEnv(c.env, AssistantEnvSchema).NUMBER_B];
    }
    const calling = body.pass_token
      ? (body.from_number ?? (numbers?.length === 1 ? numbers[0] : undefined))
      : numbers?.[0];
    if (!calling) throw refused();
    const minted = await ctx.flow.hub.mintPassCode({ pass_id, calling_number: calling });
    if (!minted.ok) throw refused();
    c.executionCtx.waitUntil(
      ctx.flow.hub
        .broadcast(
          {
            type: 'call_update',
            at: new Date(ctx.flow.clock.nowMs()).toISOString(),
            run_id: body.run_id,
            agent: 'assistant',
            speaker: 'system',
            text: 'Halyn issued a one-time Pass code for this call (5 minutes, single use).',
          },
          ['assistant', 'stage'],
        )
        .then(
          () => undefined,
          () => undefined,
        ),
    );
    return c.json(GetPassCodeResponseSchema.parse({ code: minted.code }));
  };
}
