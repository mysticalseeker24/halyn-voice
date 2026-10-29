import {
  BolnaExecutionSchema,
  bolnaPhone,
  E164Schema,
  HalynError,
  isTerminalExecution,
  maskNumbers,
  OkResponseSchema,
  RunIdSchema,
} from '@halyn/shared';
import type { Context } from 'hono';
import { registeredNumberHash } from '../db/numbers';
import { PhoneEnvSchema } from '../env';
import type { AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { toolContext } from './common';

/**
 * POST /webhooks/bolna — Bolna's execution record (agent webhook, several times per call; and the tools' pre-call
 * webhook). Decisions never depend on it: it maps a call's call_sid to its run id (the fallback when `%(execution_id)s`
 * does not substitute) and records when the call ended and its recording. Unreadable bodies are acknowledged and
 * ignored, so Bolna does not retry them. When a call ends, its transcript (numbers masked, last 2,000 characters) goes
 * to the apps as one `call_update` — the Assistant app and the Stage show it; a repeat simply replaces it.
 */
export function bolnaWebhook(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const ctx = toolContext(c, deps);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new HalynError('E_BAD_REQUEST', 'The body must be JSON');
    }
    const parsed = BolnaExecutionSchema.safeParse(raw);
    if (!parsed.success) return c.json(OkResponseSchema.parse({ ok: false }));
    const execution = parsed.data;
    const purpose = execution.context_details?.recipient_data?.purpose;
    // The calling number as Bolna's telephony recorded it: the proof of a registered number comes from here when
    // Bolna sent it, never from a tool body the LLM can also fill (Step 16 review). Inbound calls only.
    const from = bolnaPhone(execution.telephony_data?.from_number);
    const pepper = PhoneEnvSchema.safeParse(c.env);
    const number =
      execution.telephony_data?.call_type === 'inbound' &&
      E164Schema.safeParse(from).success &&
      pepper.success
        ? (from as string)
        : null;
    await ctx.flow.hub.recordExecution({
      run_id: execution.id,
      call_sid: execution.telephony_data?.call_sid ?? execution.telephony_data?.provider_call_id ?? null,
      ended: isTerminalExecution(execution.status),
      recording_url: execution.telephony_data?.recording_url ?? null,
      purpose: typeof purpose === 'string' ? purpose.slice(0, 32) : null,
      number_hash:
        number && pepper.success ? await registeredNumberHash(pepper.data.PHONE_HASH_PEPPER, number) : null,
      from_last4: number ? number.slice(-4) : null,
    });
    const run = RunIdSchema.safeParse(execution.id);
    if (isTerminalExecution(execution.status) && execution.transcript && run.success)
      c.executionCtx.waitUntil(
        ctx.flow.hub
          .broadcast(
            {
              type: 'call_update',
              at: new Date(ctx.flow.clock.nowMs()).toISOString(),
              run_id: run.data,
              agent: agentKind(c.env, execution.agent_id),
              speaker: 'system',
              text: maskNumbers(execution.transcript).slice(-2000),
            },
            ['assistant', 'stage', 'console'],
          )
          .then(
            () => undefined,
            () => undefined,
          ),
      );
    return c.json(OkResponseSchema.parse({ ok: true }));
  };
}

function agentKind(env: unknown, agent_id: string | null | undefined): 'aero' | 'confirm' | 'assistant' {
  const ids = env as { BOLNA_CONFIRM_AGENT_ID?: unknown; BOLNA_ASSISTANT_AGENT_ID?: unknown };
  if (agent_id && agent_id === ids.BOLNA_CONFIRM_AGENT_ID) return 'confirm';
  if (agent_id && agent_id === ids.BOLNA_ASSISTANT_AGENT_ID) return 'assistant';
  return 'aero';
}
