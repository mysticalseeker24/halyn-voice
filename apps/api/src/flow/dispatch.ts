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

export async function dispatchProposal(ctx: FlowContext, outcome: ProposeOutcome): Promise<void> {
  if (outcome.duplicate) return;
  const { record } = outcome;
  try {
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
