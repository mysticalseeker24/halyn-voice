import { HalynError, JudgeSignupRequestSchema, SessionResponseSchema, timingSafeEqual } from '@halyn/shared';
import type { Context } from 'hono';
import { signSession } from '../auth/session';
import { registeredNumberHash } from '../db/numbers';
import { PhoneEnvSchema, requireEnv, SessionEnvSchema } from '../env';
import type { AppDeps } from '../flow/context';
import { logLine } from '../http/errors';
import type { AppEnv } from '../http/app-env';
import { hubFor } from '../hub/client';
import { readJson } from './session-route';

// Judges try Halyn on their own phone (pitch deck slide 13, docs/DECK.md). With the judge access code, a name and
// the number they will call from, they get their own demo customer (India + the US twin, same demo account as Saksham's
// via Aero Core's template) and a customer session for the Aero app. Halyn never calls a judge's number: the Confirm
// callback goes only to the number configured for the demo, so a judge's step-ups use the passkey in their Aero app.

/** POST /web/judges/signup `{code, name, phone}` → a customer session (the same shape as POST /web/session). */
export function judgeSignup(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const env = requireEnv(c.env, SessionEnvSchema);
    const parsed = JudgeSignupRequestSchema.safeParse(await readJson(c));
    if (!parsed.success)
      throw new HalynError('E_BAD_REQUEST', 'Enter the access code, your name and your number');
    const body = parsed.data;
    if (env.JUDGE_ACCESS_CODE === undefined || !timingSafeEqual(body.code, env.JUDGE_ACCESS_CODE))
      throw new HalynError('E_UNAUTHORIZED', 'That judge access code was not accepted');
    // Aero's own lines (A answers, B is the assistant's and Confirm's) and the demo customer's phone are not a judge's:
    // registering one would turn the assistant's calls, or the demo customer's, into this judge's.
    const env_ = c.env as unknown as Record<string, unknown>;
    if (['NUMBER_A', 'NUMBER_B', 'CUSTOMER_PHONE'].some((k) => env_[k] === body.phone))
      throw new HalynError('E_BAD_REQUEST', 'That number belongs to the demo; use your own mobile number');
    const { PHONE_HASH_PEPPER } = requireEnv(c.env, PhoneEnvSchema);
    const { customer_id, created } = await hubFor(c.env, env.DEFAULT_TENANT_ID).registerJudge({
      name: body.name,
      number_hash: await registeredNumberHash(PHONE_HASH_PEPPER, body.phone),
      last4: body.phone.slice(-4),
    });
    logLine({ level: 'info', component: 'judges', customer_id, created });
    const { token, session } = await signSession(
      { tenant_id: env.DEFAULT_TENANT_ID, kind: 'customer', customer_id },
      env.SESSION_SECRET,
      deps.clock.nowMs(),
    );
    return c.json(SessionResponseSchema.parse({ token, ...session }));
  };
}
