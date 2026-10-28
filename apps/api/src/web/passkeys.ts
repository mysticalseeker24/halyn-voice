import {
  ApprovalDeclineResponseSchema,
  ApprovalOptionsResponseSchema,
  ApprovalVerifyRequestSchema,
  ApprovalVerifyResponseSchema,
  base64urlDecode,
  base64urlEncode,
  canonicalJson,
  HalynError,
  PasskeyRegisterOptionsResponseSchema,
  PasskeyRegisterVerifyRequestSchema,
  PasskeyRegisterVerifyResponseSchema,
  RequestIdSchema,
  sha256Hex,
  utf8,
} from '@halyn/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import { afterAnswer, answerConfirmation } from '../confirm/answer';
import { requireEnv, WebEnvSchema } from '../env';
import { type AppDeps, type FlowContext, flowContext } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import type { RequestRecord } from '../hub/types';
import { type Expected, verifyAuthentication, verifyRegistration } from '../webauthn/verify';
import { readJson } from './session-route';

// The passkey routes of the Aero app (docs/API.md "Web"): one-time registration, and the Confirm passkey leg — a
// step-up's approval sheet asks for options bound to the exact action, then verifies the assertion. A decline needs
// no passkey (it can only make things stricter). Every answer goes through the Hub, where the first answer wins
// (invariant 10). Customer sessions only; the customer always comes from the session, never from the body.

const REGISTER_TTL_MS = 5 * 60 * 1000;
/**
 * An approval challenge outlives the 60 s deadline by this much, so an assertion signed in time but delivered late
 * still reaches the Hub. The Hub alone decides "too late" (one clock): it settles the timeout and records the answer
 * as ignored (invariant 10). A late answer can never count; the challenge stays single use.
 */
const LATE_ANSWER_WINDOW_MS = 30 * 1000;

function customer(c: Context<AppEnv>): { tenant: string; customer_id: string } {
  const session = c.get('session');
  if (session.kind !== 'customer' || session.customer_id === null)
    throw new HalynError('E_UNAUTHORIZED', 'A customer session is required');
  return { tenant: session.tenant_id, customer_id: session.customer_id };
}

function expected(c: Context<AppEnv>, challenge: string): Expected {
  const { WEB_ORIGIN, RP_ID } = requireEnv(c.env, WebEnvSchema);
  return { challenge, origins: WEB_ORIGIN, rpId: RP_ID };
}

/** The challenge a WebAuthn response answers (taken from its client data, then checked against the Hub's copy). */
function challengeOf(clientDataJSON: string): string {
  const bytes = base64urlDecode(clientDataJSON);
  try {
    const data = z
      .object({ challenge: z.string().min(16).max(128) })
      .parse(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes ?? new Uint8Array()),
        ),
      );
    return data.challenge;
  } catch {
    throw new HalynError('E_BAD_REQUEST', 'The passkey could not be verified (client data)');
  }
}

// ── registration ────────────────────────────────────────────────────────────────────────────────

/** POST /web/passkeys/register/options → `{options}` (WebAuthn creation options; attestation "none"). */
export function registerOptions(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const { RP_ID } = requireEnv(c.env, WebEnvSchema);
    const flow = flowContext(c.env, tenant, deps);
    const view = await flow.hub.customerView(customer_id);
    if (!view.customer) throw new HalynError('E_NOT_FOUND', 'No such customer');
    const challenge = base64urlEncode(deps.rng.bytes(32));
    await flow.hub.putChallenge({
      challenge,
      kind: 'register',
      customer_id,
      request_id: null,
      expires_at: deps.clock.nowMs() + REGISTER_TTL_MS,
    });
    const existing = await flow.hub.passkeys(customer_id);
    return c.json(
      PasskeyRegisterOptionsResponseSchema.parse({
        options: {
          rp: { id: RP_ID, name: 'Aero Bank' },
          user: {
            id: base64urlEncode(utf8(customer_id)),
            name: customer_id,
            displayName: view.customer.name,
          },
          challenge,
          pubKeyCredParams: [-8, -7, -257].map((alg) => ({ type: 'public-key', alg })),
          timeout: REGISTER_TTL_MS,
          attestation: 'none',
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          excludeCredentials: existing.map((k) => ({ type: 'public-key', id: k.id })),
        },
      }),
    );
  };
}

/** POST /web/passkeys/register/verify `{response}` → `{ok: true}`. */
export function registerVerify(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const { response } = PasskeyRegisterVerifyRequestSchema.parse(await readJson(c));
    const flow = flowContext(c.env, tenant, deps);
    const challenge = challengeOf(response.response.clientDataJSON);
    const fresh = await flow.hub.takeChallenge({
      challenge,
      kind: 'register',
      customer_id,
      request_id: null,
    });
    if (!fresh) throw new HalynError('E_BAD_REQUEST', 'The passkey could not be verified (challenge)');
    const passkey = await verifyRegistration(response, expected(c, challenge));
    await flow.hub.savePasskey({
      id: passkey.id,
      customer_id,
      alg: passkey.alg,
      jwk: passkey.jwk,
      sign_count: passkey.sign_count,
      created_at: new Date(deps.clock.nowMs()).toISOString(),
    });
    return c.json(PasskeyRegisterVerifyResponseSchema.parse({ ok: true }));
  };
}

// ── the Confirm passkey leg ─────────────────────────────────────────────────────────────────────

async function pendingFor(
  flow: FlowContext,
  c: Context<AppEnv>,
  customer_id: string,
): Promise<RequestRecord> {
  const id = RequestIdSchema.safeParse(c.req.param('id'));
  const record = id.success ? await flow.hub.requestState(id.data) : null;
  // Another customer's request is indistinguishable from none (invariant 8).
  if (!record || record.customer_id !== customer_id || !record.confirm)
    throw new HalynError('E_NOT_FOUND', 'No such approval');
  return record;
}

function alreadyAnswered(status: string): HalynError {
  return new HalynError('E_BAD_REQUEST', `This request was already answered (${status})`);
}

/**
 * POST /web/approvals/:id/options → `{options}`. The challenge is SHA-256 of the canonical action, its params hash, the
 * request id and a fresh nonce (docs/ARCHITECTURE.md "Confirmation"): the signature covers exactly what was shown.
 */
export function approvalOptions(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const { RP_ID } = requireEnv(c.env, WebEnvSchema);
    const flow = flowContext(c.env, tenant, deps);
    const record = await pendingFor(flow, c, customer_id);
    const now = deps.clock.nowMs();
    if (record.status !== 'awaiting_confirmation' || !record.confirm || record.confirm.deadline <= now)
      throw alreadyAnswered(record.final_outcome ?? record.status);
    const passkeys = await flow.hub.passkeys(customer_id);
    if (passkeys.length === 0) throw new HalynError('E_BAD_REQUEST', 'Register a passkey first');
    const digest = await sha256Hex(
      canonicalJson({
        request_id: record.request_id,
        action: record.action,
        params_hash: record.params_hash,
        nonce: base64urlEncode(deps.rng.bytes(16)),
      }),
    );
    const challenge = base64urlEncode(Uint8Array.from(digest.match(/../g) ?? [], (h) => parseInt(h, 16)));
    await flow.hub.putChallenge({
      challenge,
      kind: 'approve',
      customer_id,
      request_id: record.request_id,
      expires_at: record.confirm.deadline + LATE_ANSWER_WINDOW_MS,
    });
    return c.json(
      ApprovalOptionsResponseSchema.parse({
        options: {
          challenge,
          rpId: RP_ID,
          timeout: Math.max(1000, record.confirm.deadline - now),
          userVerification: 'required',
          allowCredentials: passkeys.map((k) => ({ type: 'public-key', id: k.id })),
        },
      }),
    );
  };
}

/** POST /web/approvals/:id/verify `{response}` → `{ok: true, status: "approved"}` when this answer counted. */
export function approvalVerify(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const { response } = ApprovalVerifyRequestSchema.parse(await readJson(c));
    const flow = flowContext(c.env, tenant, deps);
    const record = await pendingFor(flow, c, customer_id);
    const challenge = challengeOf(response.response.clientDataJSON);
    const fresh = await flow.hub.takeChallenge({
      challenge,
      kind: 'approve',
      customer_id,
      request_id: record.request_id,
    });
    if (!fresh) throw new HalynError('E_BAD_REQUEST', 'The passkey could not be verified (challenge)');
    const stored = (await flow.hub.passkeys(customer_id)).find((k) => k.id === response.rawId);
    if (!stored) throw new HalynError('E_BAD_REQUEST', 'The passkey could not be verified (unknown passkey)');
    const { sign_count } = await verifyAuthentication(response, expected(c, challenge), stored);
    await flow.hub.savePasskey({ ...stored, sign_count });
    const { outcome, settled } = await answerConfirmation(flow, {
      request_id: record.request_id,
      answer: 'approved',
      channel: 'passkey',
      customer_id,
    });
    if (!outcome.accepted || !settled) throw alreadyAnswered(outcome.status);
    c.executionCtx.waitUntil(afterAnswer(flow, settled, 'passkey'));
    return c.json(ApprovalVerifyResponseSchema.parse({ ok: true, status: 'approved' }));
  };
}

/** POST /web/approvals/:id/decline `{}` → `{ok: true, status: "declined"}` when this answer counted. */
export function approvalDecline(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const { tenant, customer_id } = customer(c);
    const flow = flowContext(c.env, tenant, deps);
    const record = await pendingFor(flow, c, customer_id);
    const { outcome, settled } = await answerConfirmation(flow, {
      request_id: record.request_id,
      answer: 'declined',
      channel: 'passkey',
      customer_id,
    });
    if (!outcome.accepted || !settled) throw alreadyAnswered(outcome.status);
    c.executionCtx.waitUntil(afterAnswer(flow, settled, 'passkey'));
    return c.json(ApprovalDeclineResponseSchema.parse({ ok: true, status: 'declined' }));
  };
}
