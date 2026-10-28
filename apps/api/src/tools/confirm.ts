import { ConfirmResultRequestSchema, OkResponseSchema } from '@halyn/shared';
import type { Context } from 'hono';
import { afterAnswer, answerConfirmation } from '../confirm/answer';
import type { AppDeps } from '../flow/context';
import type { AppEnv } from '../http/app-env';
import { readToolBody, toolContext } from './common';

/**
 * POST /tools/confirm_result — the Confirm agent's answer from the customer's registered phone. `{ok: true}` when it
 * was recorded (whether it counted or came after another answer, invariant 10); 404 when this call may not answer.
 */
export function confirmResult(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const ctx = toolContext(c, deps);
    const { body } = await readToolBody(c, 'confirm_result', ConfirmResultRequestSchema, ctx);
    const { settled } = await answerConfirmation(ctx.flow, {
      request_id: body.request_id,
      answer: body.answer === 'approve' ? 'approved' : 'declined',
      channel: 'callback',
      run_id: body.run_id,
    });
    if (settled) c.executionCtx.waitUntil(afterAnswer(ctx.flow, settled, 'callback'));
    // The answer is stored: move the Confirm call to its goodbye node, which hangs up (Day-0: it lingered otherwise).
    const bolna = ctx.flow.bolna;
    if (bolna)
      c.executionCtx.waitUntil(
        bolna.sendEvent(body.run_id, { event: 'recorded', properties: { request_id: body.request_id } }),
      );
    return c.json(OkResponseSchema.parse({ ok: true }));
  };
}
