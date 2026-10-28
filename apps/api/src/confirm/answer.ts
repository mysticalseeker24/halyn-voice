import { type ConfirmChannel, HalynError } from '@halyn/shared';
import type { FlowContext } from '../flow/context';
import { executeRequest } from '../flow/execute';
import type { ConfirmationOutcome } from '../hub/hub-do';
import type { RequestRecord } from '../hub/types';

// An answer to a step-up, from either leg: the Aero app's passkey (POST /web/approvals/:id/verify|decline) or the
// Confirm agent's `confirm_result` tool. The Hub decides which answer counts — the first; later ones are recorded and
// ignored (invariant 10); after 60 s its alarm answers `timeout` itself. The final outcome comes from the Gate's
// post-approval rules in the Hub (flows.ts settleRequest). This module then does the slow part outside the lane: the
// event into the call, stopping the other leg, and — on approval — execution.

export interface AnswerInput {
  request_id: string;
  answer: 'approved' | 'declined';
  channel: ConfirmChannel;
  /** For a callback answer: the answering call's run id; it must be the Confirm call Halyn placed for this request. */
  run_id?: string;
  /** For a passkey answer: the customer whose session answered. */
  customer_id?: string;
}

export interface AnswerResult {
  outcome: ConfirmationOutcome;
  /** The request after settlement, when this answer was the one that counted. */
  settled: RequestRecord | null;
}

/**
 * Record an answer. Throws E_NOT_FOUND — the same answer as for no request at all, and nothing recorded — for a caller
 * that may not answer: a passkey answer from another customer's session, or a callback answer from any call but the
 * Confirm call Halyn placed for this request. The callback is out-of-band proof only because Halyn dialled the
 * registered number itself, so until that call is attached (or when it was never placed) no call can answer on it —
 * not the Aero call, not a call known only by its call sid.
 */
export async function answerConfirmation(ctx: FlowContext, input: AnswerInput): Promise<AnswerResult> {
  const record = await ctx.hub.requestState(input.request_id);
  if (!record?.confirm) throw new HalynError('E_NOT_FOUND', 'No such confirmation');
  if (input.channel === 'passkey' && (!input.customer_id || record.customer_id !== input.customer_id))
    throw new HalynError('E_NOT_FOUND', 'No such confirmation');
  if (
    input.channel === 'callback' &&
    (record.confirm.execution_id === null || input.run_id !== record.confirm.execution_id)
  )
    throw new HalynError('E_NOT_FOUND', 'No such confirmation');
  const outcome = await ctx.hub.resolveConfirmation({
    request_id: input.request_id,
    answer: input.answer,
    channel: input.channel,
  });
  const settled = outcome.accepted ? await ctx.hub.requestState(input.request_id) : null;
  return { outcome, settled };
}

/**
 * After the answer that counted: tell the Aero call (`approved` / `denied` / `hold`), stop the Confirm call if the
 * passkey won while it was still queued, and execute an approval. Never throws (it runs in waitUntil).
 */
export async function afterAnswer(
  ctx: FlowContext,
  settled: RequestRecord,
  channel: ConfirmChannel,
): Promise<void> {
  try {
    const stop =
      channel === 'passkey' && settled.confirm?.execution_id && ctx.bolna
        ? ctx.bolna.stopCall(settled.confirm.execution_id)
        : Promise.resolve(false);
    if (settled.last_event && ctx.bolna) await ctx.bolna.sendEvent(settled.run_id, settled.last_event);
    await stop;
    if (settled.status === 'approved') await executeRequest(ctx, settled.request_id);
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'error',
        component: 'confirm',
        request_id: settled.request_id,
        detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
      }),
    );
  }
}
