import {
  ApprovalOptionsResponseSchema,
  AssistantTaskRequestSchema,
  AssistantTaskResponseSchema,
  base64urlEncode,
  canonicalJson,
  HalynError,
  IssuePassRequestSchema,
  IssuePassResponseSchema,
  ListPassesResponseSchema,
  PassIdSchema,
  PassOptionsRequestSchema,
  RevokePassResponseSchema,
  sha256Hex,
} from '@halyn/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import { inCallingWindow } from '../confirm/start';
import { AssistantEnvSchema, requireEnv, WebEnvSchema } from '../env';
import { type AppDeps, flowContext } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { loadPacks } from '../packs/load';
import { issuePass, type PassRow, passRow, passState, signPass } from '../pass';
import { verifyAuthentication } from '../webauthn/verify';
import { challengeOf, customer, expected } from './passkeys';
import { readJson } from './session-route';

// Halyn Pass in the Aero app (docs/PASS.md): the customer picks the assistant, Pass-eligible actions and an expiry,
// and approves with their passkey. The challenge binds exactly that draft (SHA-256 of its canonical JSON for this
// customer), so a signature over one draft can never issue another. Then Halyn signs the Pass; revoke is one tap.
// POST /web/assistant/tasks starts the Assistant's call to Aero on one of the customer's Passes (number B → A).

const CONSENT_TTL_MS = 2 * 60 * 1000;

type Draft = z.output<typeof PassOptionsRequestSchema>;

function summary(row: PassRow, nowMs: number) {
  return {
    id: row.id,
    assistant_name: row.assistant_name,
    assistant_numbers: row.assistant_numbers,
    scopes: row.scopes,
    status: passState(row, nowMs),
    issued_at: row.issued_at,
    expires_at: row.expires_at,
  };
}

function draftDigest(customer_id: string, draft: Draft): Promise<string> {
  return sha256Hex(canonicalJson({ customer_id, ...draft }));
}

async function packFor(c: Context<AppEnv>, deps: AppDeps, tenant: string, customer_id: string) {
  const flow = flowContext(c.env, tenant, deps);
  const view = await flow.hub.customerView(customer_id);
  if (!view.customer) throw new HalynError('E_NOT_FOUND', 'No such customer');
  const pack = (await loadPacks(c.env.CONFIG, tenant))[view.customer.region];
  if (!pack) throw new HalynError('E_FAIL_CLOSED', 'passes: no policy pack for this region');
  return { flow, view: { ...view, customer: view.customer }, pack };
}

/** POST /web/passes/options `{assistant, scopes, expires_in_days}` → `{options}` bound to this draft. */
export function passOptions(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const { RP_ID } = requireEnv(c.env, WebEnvSchema);
    const draft = PassOptionsRequestSchema.parse(await readJson(c));
    const { flow, pack } = await packFor(c, deps, tenant, customer_id);
    // Refuse an ineligible draft before asking for the passkey (issue checks again).
    const check = issuePass(
      { tenant, customer_id, ...draft, customer_passkey_sig: 'AAAA' },
      pack,
      deps.clock,
      deps.rng,
    );
    if (!check.ok) throw new HalynError('E_BAD_REQUEST', check.message);
    const passkeys = await flow.hub.passkeys(customer_id);
    if (passkeys.length === 0) throw new HalynError('E_BAD_REQUEST', 'Register a passkey first');
    const digest = await draftDigest(customer_id, draft);
    const bound = await sha256Hex(
      canonicalJson({ draft: digest, nonce: base64urlEncode(deps.rng.bytes(16)) }),
    );
    const challenge = base64urlEncode(Uint8Array.from(bound.match(/../g) ?? [], (h) => parseInt(h, 16)));
    await flow.hub.putChallenge({
      challenge,
      kind: 'pass',
      customer_id,
      request_id: digest,
      expires_at: deps.clock.nowMs() + CONSENT_TTL_MS,
    });
    return c.json(
      ApprovalOptionsResponseSchema.parse({
        options: {
          challenge,
          rpId: RP_ID,
          timeout: CONSENT_TTL_MS,
          userVerification: 'required',
          allowCredentials: passkeys.map((k) => ({ type: 'public-key', id: k.id })),
        },
      }),
    );
  };
}

/** POST /web/passes `{assistant, scopes, expires_in_days, response}` → `{pass, token}`. */
export function issuePassRoute(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const { response, ...draft } = IssuePassRequestSchema.parse(await readJson(c));
    const { flow, pack } = await packFor(c, deps, tenant, customer_id);
    const challenge = challengeOf(response.response.clientDataJSON);
    const fresh = await flow.hub.takeChallenge({
      challenge,
      kind: 'pass',
      customer_id,
      request_id: await draftDigest(customer_id, draft),
    });
    if (!fresh) throw new HalynError('E_BAD_REQUEST', 'The passkey could not be verified (challenge)');
    const stored = (await flow.hub.passkeys(customer_id)).find((k) => k.id === response.rawId);
    if (!stored) throw new HalynError('E_BAD_REQUEST', 'The passkey could not be verified (unknown passkey)');
    const { sign_count } = await verifyAuthentication(response, expected(c, challenge), stored);
    await flow.hub.savePasskey({ ...stored, sign_count });
    const issued = issuePass(
      { tenant, customer_id, ...draft, customer_passkey_sig: response.response.signature },
      pack,
      deps.clock,
      deps.rng,
    );
    if (!issued.ok) throw new HalynError('E_BAD_REQUEST', issued.message);
    const token = await signPass(issued.claims, await flow.signer());
    const row = await flow.hub.issuePass(passRow(issued.claims, token));
    return c.json(IssuePassResponseSchema.parse({ pass: summary(row, deps.clock.nowMs()), token }), 201);
  };
}

/** GET /web/passes → `{passes}` (the customer's own). */
export function listPasses(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const rows = await flowContext(c.env, tenant, deps).hub.customerPasses(customer_id);
    const now = deps.clock.nowMs();
    return c.json(ListPassesResponseSchema.parse({ passes: rows.map((r) => summary(r, now)) }));
  };
}

/** DELETE /web/passes/:id → `{pass}` (revoked). Another customer's Pass is 404. */
export function revokePassRoute(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const id = PassIdSchema.safeParse(c.req.param('id'));
    const row = id.success
      ? await flowContext(c.env, tenant, deps).hub.revokePass(customer_id, id.data)
      : null;
    if (!row) throw new HalynError('E_NOT_FOUND', 'No such Pass');
    return c.json(RevokePassResponseSchema.parse({ pass: summary(row, deps.clock.nowMs()) }));
  };
}

/**
 * POST /web/assistant/tasks `{task, pass_id}` → `{ok, execution_id}`: the Assistant agent calls Aero's number A from
 * number B (our own numbers; 09:00–21:00 IST; never `bypass_call_guardrails`). The call is bound to the Pass, so its
 * get_pass_code needs no token from the LLM.
 */
export function assistantTask(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const body = AssistantTaskRequestSchema.parse(await readJson(c));
    const env = requireEnv(c.env, AssistantEnvSchema);
    const flow = flowContext(c.env, tenant, deps);
    if (!flow.bolna) throw new HalynError('E_FAIL_CLOSED', 'assistant: Bolna is not configured');
    if (!inCallingWindow(deps.clock.nowMs()))
      throw new HalynError('E_BAD_REQUEST', 'The assistant calls only between 09:00 and 21:00 IST');
    const pass = (await flow.hub.customerPasses(customer_id)).find((p) => p.id === body.pass_id);
    if (!pass) throw new HalynError('E_NOT_FOUND', 'No such Pass');
    if (passState(pass, deps.clock.nowMs()) !== 'active' || !pass.assistant_numbers.includes(env.NUMBER_B))
      throw new HalynError('E_BAD_REQUEST', 'This Pass cannot be used for the call');
    const view = await flow.hub.customerView(customer_id);
    if (!view.customer) throw new HalynError('E_NOT_FOUND', 'No such customer');
    const { execution_id } = await flow.bolna.startCall({
      agent_id: env.BOLNA_ASSISTANT_AGENT_ID,
      recipient_phone_number: env.NUMBER_A,
      from_phone_number: env.NUMBER_B,
      user_data: {
        task: body.task,
        // The spoken form (Devanagari for Saksham): Sarvam reads Roman "Saksham" wrong (CLAUDE.md §8).
        customer_name: view.customer.spoken_name,
        purpose: 'assistant_task',
        timezone: 'Asia/Kolkata',
      },
    });
    await flow.hub.attachAssistantCall(execution_id, pass.id);
    return c.json(AssistantTaskResponseSchema.parse({ ok: true, execution_id }), 201);
  };
}
