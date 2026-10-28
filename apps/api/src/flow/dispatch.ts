import { startCallback } from '../confirm/start';
import type { ProposeOutcome } from '../hub/flows';
import type { FlowContext } from './context';
import { executeRequest } from './execute';

// docs/ARCHITECTURE.md "Main flow" step 7, after propose_action has answered `{request_id, status: "pending"}`:
//   allow   → event `allow`, then execute (grant → Aero Core → `done`, or `deny` if the bank refused)
//   step_up → event `step_up` and, in parallel, the Confirm callback (the Hub already pushed the passkey prompt and
//             started the 60 s timer)
//   hold    → event `hold` (the Hub opened the handoff)
//   deny    → event `deny`
// A duplicate proposal (an LLM retry) dispatches nothing: the first one already did. Never throws (waitUntil). If this
// Worker dies before executeRequest claims an allowed request, the Hub's sweep fails it closed 30 s after the approval
// (deny E_FAIL_CLOSED, nothing signed; ADR-020) and a late claim gets nothing.
// A money allow/step_up the Hub marked `screening` first waits (≤ 1.5 s) for coaching layer 2 (ADR-024): no event,
// grant, approval sheet or Confirm call until finishScreening clears it or turns it into the coaching hold. A Worker
// that dies here leaves it to the same sweep (allow) or the confirmation timer (step_up): both fail closed.

export async function dispatchProposal(ctx: FlowContext, outcome: ProposeOutcome): Promise<void> {
  if (outcome.duplicate) return;
  let { record } = outcome;
  try {
    if (record.screening) {
      const layer2 = ctx.coachingLlm ? await ctx.coachingLlm(record.caller_quotes) : null;
      const screened = await ctx.hub.finishScreening(record.request_id, layer2);
      if (!screened) return;
      record = screened;
    }
    const event = record.last_event
      ? (ctx.bolna?.sendEvent(record.run_id, record.last_event) ?? Promise.resolve(null))
      : Promise.resolve(null);
    if (record.status === 'approved') {
      // The call hears `allow` before `done`: the graph's `working` node only listens for `done`.
      await event;
      await executeRequest(ctx, record.request_id);
    } else if (record.status === 'awaiting_confirmation') {
      await Promise.all([event, startCallback(ctx, record, outcome.customer)]);
    } else {
      await event;
    }
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'error',
        component: 'dispatch',
        request_id: record.request_id,
        detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
      }),
    );
  }
}
