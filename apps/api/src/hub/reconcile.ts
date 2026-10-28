import {
  ActionIdSchema,
  type Clock,
  type CoreActionId,
  type CoreResponse,
  isCoreAction,
} from '@halyn/shared';
import { type CoreTransport, callCore } from '../core-client/client';
import { executionResult } from '../flow/execute';
import type { SignedGrant } from '../grants';
import { type ExecutionResult, finishExecution, grantFromToken, type HubCore } from './flows';
import type { RequestRecord } from './types';

// The sweep (ADR-020): a Worker that dies between beginExecution and finishExecution leaves a request `executing`
// with nobody to finish it. The Hub's alarm takes every request that has been executing for SWEEP_DELAY_MS (by then
// the Worker's waitUntil, at most 30 s after its response, is over) and resolves it:
//   no grant noted        → nothing can have reached Aero Core → failed, deny E_FAIL_CLOSED
//   grant noted, valid    → present the SAME grant again (never a second one): executed → done; refused → deny;
//                           still unknown → as below
//   grant expired/unknown → failed outcome unknown, deny E_FAIL_CLOSED, ledger marked for reconciliation, handoff
// A Worker can also die after the decision but before it claims the request: the request sits `approved`. The sweep
// takes every request approved SWEEP_DELAY_MS ago that no Worker claimed → nothing signed, nothing sent → failed, deny
// E_FAIL_CLOSED; a late Worker's beginExecution then finds nothing to claim.
// The lane part (sweepExecutions) is bounded per alarm (both kinds together); presenting runs outside the lane, and
// its finish is first-finish-wins against a late Worker (flows.ts finishExecution).

/**
 * How long a request may stay `executing` — or `approved` without a Worker claiming it — before the sweep takes it
 * (well inside the grant's 60–120 s life).
 */
export const SWEEP_DELAY_MS = 30_000;
/** At most this many requests per alarm, executions and unclaimed approvals together (CPU); the alarm comes straight back for the rest. */
export const SWEEP_BATCH = 10;
/** A grant is only presented again while it has at least this long to live (Aero Core may answer in seconds). */
export const PRESENT_MARGIN_MS = 10_000;

/** A request whose grant the sweep presents again, outside the lane. */
export interface PresentAgain {
  record: RequestRecord;
  grant: SignedGrant;
}

/** Lane part: settle what can be settled now and hand back the grants to present again. */
export async function sweepExecutions(
  core: HubCore,
): Promise<{ finished: RequestRecord[]; present: PresentAgain[] }> {
  const { store } = core;
  const now = core.clock.nowMs();
  const finished: RequestRecord[] = [];
  const present: PresentAgain[] = [];
  const executions = store.dueExecutions(now - SWEEP_DELAY_MS, SWEEP_BATCH);
  for (const row of executions) {
    const record = store.request(row.request_id);
    if (!record || record.status !== 'executing') {
      store.endExecution(row.request_id);
      continue;
    }
    let grant: SignedGrant | null = null;
    if (row.token !== null)
      try {
        grant = grantFromToken(row.token);
      } catch {
        grant = null;
      }
    if (row.token !== null && grant !== null && now + PRESENT_MARGIN_MS < grant.claims.exp * 1000) {
      store.markSwept(row.request_id, now);
      present.push({ record, grant });
      continue;
    }
    const done = await finishExecution(
      core,
      row.request_id,
      row.token === null
        ? { status: 'failed', code: 'E_FAIL_CLOSED', http: null, outcome: 'refused' }
        : { status: 'failed', code: 'E_FAIL_CLOSED', http: null, outcome: 'unknown' },
      { by: 'sweep', detail: row.token === null ? 'no_grant' : 'grant_expired' },
    );
    if (done) finished.push(done);
  }
  // Approved but never claimed: the Worker died between the decision and beginExecution.
  for (const request_id of store.dueApprovals(now - SWEEP_DELAY_MS, SWEEP_BATCH - executions.length)) {
    if (store.request(request_id)?.status !== 'approved') {
      store.clearApproved(request_id);
      continue;
    }
    const done = await finishExecution(
      core,
      request_id,
      { status: 'failed', code: 'E_FAIL_CLOSED', http: null, outcome: 'refused' },
      { by: 'sweep', detail: 'not_claimed' },
    );
    if (done) finished.push(done);
  }
  return { finished, present };
}

/** Outside the lane: present the noted grant once more and read Aero Core's answer as the Worker would. */
export async function presentGrant(
  transport: CoreTransport | null,
  item: PresentAgain,
  clock: Clock,
): Promise<{ result: ExecutionResult; body: CoreResponse<CoreActionId> | null }> {
  const { record, grant } = item;
  const action = ActionIdSchema.safeParse(record.action);
  if (!transport || !action.success || !isCoreAction(action.data))
    return { result: executionResult(record, null, { status: 'unknown', http: null }), body: null };
  const answer = await callCore({
    transport,
    grant,
    action: action.data,
    params: record.params,
    clock,
    presentedBefore: true,
  });
  return {
    result: executionResult(record, grant.claims.jti, answer),
    body: answer.status === 'executed' ? answer.body : null,
  };
}
