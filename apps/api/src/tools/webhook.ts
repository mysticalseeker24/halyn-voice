import { BolnaExecutionSchema, HalynError, isTerminalExecution, OkResponseSchema } from '@halyn/shared';
import type { Context } from 'hono';
import type { AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { toolContext } from './common';

/**
 * POST /webhooks/bolna — Bolna's execution record (agent webhook, several times per call; and the tools' pre-call
 * webhook). Decisions never depend on it: it maps a call's call_sid to its run id (the fallback when `%(execution_id)s`
 * does not substitute) and records when the call ended and its recording. Unreadable bodies are acknowledged and
 * ignored, so Bolna does not retry them.
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
    await ctx.flow.hub.recordExecution({
      run_id: execution.id,
      call_sid: execution.telephony_data?.call_sid ?? execution.telephony_data?.provider_call_id ?? null,
      ended: isTerminalExecution(execution.status),
      recording_url: execution.telephony_data?.recording_url ?? null,
      purpose: typeof purpose === 'string' ? purpose.slice(0, 32) : null,
    });
    return c.json(OkResponseSchema.parse({ ok: true }));
  };
}
