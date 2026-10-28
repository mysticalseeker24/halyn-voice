import {
  type ActionId,
  ActionIdSchema,
  type Clock,
  type CoreActionId,
  type CoreResponse,
  coreRoute,
  formatMoney,
  isCoreAction,
  type Money,
  type OutcomeEvent,
  type Region,
  type Rng,
  type Signer,
  type WsMessage,
} from '@halyn/shared';
import { type CoreResult, type CoreTransport, callCore } from '../core-client/client';
import { signGrant } from '../grants';
import type { ExecutionResult } from '../hub/flows';
import type { RequestRecord } from '../hub/types';
import type { FlowContext } from './context';

// Allow-path execution (docs/ARCHITECTURE.md "Main flow" 7, invariant 1): claim the request once in the Hub, sign a
// one-time grant bound to its exact params, call Aero Core, record the answer, tell the call (`done`, or `deny` when
// the bank refused or the outcome is unknown) and the apps (`core_update`). An approved action with no Aero Core route
// goes to a specialist (docs/ACTIONS.md "Actions with no Aero Core route"). Anything thrown here fails closed.

const MAX = 300;

function money(m: Money): string {
  return formatMoney(m);
}

function cut(text: string): string {
  return text.length <= MAX ? text : `${text.slice(0, MAX - 1)}…`;
}

/** What Aero says back after it executed (spoken; no full numbers, no names). */
export function doneSummary(
  action: CoreActionId,
  body: CoreResponse<CoreActionId> | null,
  fallback: string,
): string {
  if (!body) return cut(`Done: ${fallback}`);
  switch (body.action) {
    case 'card.freeze':
      return `The card ending ${body.card.last4} is frozen${body.already_frozen ? ' (it already was)' : ''}`;
    case 'fee.waive':
      return `The ${money(body.fee.amount)} fee is waived. Balance ${money(body.balance)}`;
    case 'emi.move_date':
      return `The EMI moves to day ${body.loan.emi_day} of each month (it was day ${body.loan.previous_emi_day})`;
    case 'transfer.new_payee':
    case 'transfer.saved':
    case 'wire.new':
      return `Sent ${money(body.transaction.amount)}. Balance ${money(body.balance)}`;
    case 'balance.view':
      return `The ${body.account} balance is ${money(body.balance)}`;
    case 'statement.view': {
      const lines = body.transactions
        .slice(0, 3)
        .map((t) => `${t.kind === 'credit' ? '+' : '-'}${money(t.amount)} ${t.description}`);
      return cut(
        `The ${body.account} balance is ${money(body.balance)}. Latest: ${lines.join('; ') || 'none'}`,
      );
    }
  }
  return cut(`Done: ${fallback}`);
}

/** The customer's main account type in a region (the Aero app's home, the balance after a write). */
export function primaryAccount(region: Region): 'savings' | 'checking' {
  return region === 'US' ? 'checking' : 'savings';
}

async function send(ctx: FlowContext, run_id: string, event: OutcomeEvent | null): Promise<void> {
  if (!event || !ctx.bolna) return;
  await ctx.bolna.sendEvent(run_id, event);
}

/** What a statement read and `core_update` need: the Worker's FlowContext, or the Hub's sweep (ADR-020). */
export interface CoreReadDeps {
  tenant: string;
  core: CoreTransport | null;
  clock: Clock;
  rng: Rng;
  signer(): Promise<Signer>;
}
export interface CoreUpdateDeps extends CoreReadDeps {
  broadcast(message: WsMessage): Promise<unknown>;
}

/** Aero Core's answer to one grant as the Hub records it (the Worker and the Hub's sweep read it the same way). */
export function executionResult(
  record: RequestRecord,
  jti: string | null,
  result: CoreResult,
): ExecutionResult {
  if (result.status === 'executed' && jti)
    return {
      status: 'executed',
      jti,
      reference: result.reference,
      summary: doneSummary(record.action as CoreActionId, result.body, record.summary),
      fresh: result.fresh,
    };
  return {
    status: 'failed',
    code: result.status === 'refused' ? result.code : 'E_FAIL_CLOSED',
    http: result.status === 'executed' ? null : result.http,
    outcome: result.status === 'refused' ? 'refused' : 'unknown',
  };
}

/**
 * A read of the customer's own statement with a Halyn grant (no proposal: the customer's app session, or the balance
 * after a write). Returns null when Aero Core is unavailable or refuses.
 */
export async function readStatement(
  ctx: CoreReadDeps,
  customer_id: string,
  region: Region,
  request_id: string,
): Promise<CoreResponse<'statement.view'> | null> {
  if (!ctx.core) return null;
  const params = { account: primaryAccount(region) };
  try {
    const grant = await signGrant(
      { tenant: ctx.tenant, sub: customer_id, action: 'statement.view', params, request_id },
      await ctx.signer(),
      ctx.clock,
      ctx.rng,
    );
    const result = await callCore({
      transport: ctx.core,
      grant,
      action: 'statement.view',
      params,
      clock: ctx.clock,
    });
    return result.status === 'executed' && result.body?.action === 'statement.view' ? result.body : null;
  } catch {
    return null;
  }
}

/** Tell the apps Aero Core changed (the Aero app refetches its home; the Stage shows the balance). Never throws. */
export async function coreUpdate(
  deps: CoreUpdateDeps,
  record: RequestRecord,
  body: CoreResponse<CoreActionId> | null,
): Promise<void> {
  if (!record.customer_id || !record.execution) return;
  if (coreRoute(record.action as ActionId)?.method !== 'POST') return;
  const { reference, summary } = record.execution;
  let balance: Money | null =
    body && 'balance' in body && body.action !== 'statement.view' ? body.balance : null;
  balance ??=
    (await readStatement(deps, record.customer_id, record.region, record.request_id))?.balance ?? null;
  if (!balance) return;
  await deps
    .broadcast({
      type: 'core_update',
      at: new Date(deps.clock.nowMs()).toISOString(),
      customer_id: record.customer_id,
      balance,
      activity: { reference, summary, amount: record.gate.amount },
    })
    .catch(() => 0);
}

/** Execute an approved request exactly once. Safe to call twice: the second call finds it claimed and does nothing. */
export async function executeRequest(ctx: FlowContext, request_id: string): Promise<RequestRecord | null> {
  const claimed = await ctx.hub.beginExecution(request_id);
  if (!claimed) return null;
  const action = ActionIdSchema.safeParse(claimed.action);
  let result: CoreResult | 'handoff' | 'scheduled';
  let jti: string | null = null;
  if (!action.success || !claimed.customer_id) {
    result = { status: 'refused', code: 'E_FAIL_CLOSED', http: 0 };
  } else if (claimed.execute_at !== null) {
    // A tier-4 approval runs only after its hold (GATE.md clarification 9): the handoff carries it until then.
    result = 'scheduled';
  } else if (!coreRoute(action.data) || !isCoreAction(action.data)) {
    // No Aero Core route (docs/ACTIONS.md): a specialist completes it.
    result = 'handoff';
  } else if (!ctx.core) {
    result = { status: 'refused', code: 'E_FAIL_CLOSED', http: 0 };
  } else {
    try {
      const grant = await signGrant(
        {
          tenant: ctx.tenant,
          sub: claimed.customer_id,
          action: action.data as ActionId,
          params: claimed.params,
          request_id,
        },
        await ctx.signer(),
        ctx.clock,
        ctx.rng,
      );
      jti = grant.claims.jti;
      // The Hub keeps the exact grant before Aero Core can see it: if this Worker dies, the sweep presents the same
      // grant again (ADR-020). If the Hub cannot keep it, nothing is presented.
      await ctx.hub.noteGrant(request_id, { token: grant.token });
      result = await callCore({
        transport: ctx.core,
        grant,
        action: action.data as CoreActionId,
        params: claimed.params,
        clock: ctx.clock,
      });
    } catch {
      result = { status: 'refused', code: 'E_FAIL_CLOSED', http: 0 };
    }
  }

  let record: RequestRecord | null;
  if (result === 'handoff' || result === 'scheduled') {
    record = await ctx.hub.finishExecution(request_id, {
      status: 'handoff',
      reason: result === 'scheduled' ? 'P_TIER4_HOLD_24H' : 'H_SPECIALIST',
    });
  } else {
    record = await ctx.hub.finishExecution(request_id, executionResult(claimed, jti, result));
    if (record?.status === 'executed' && result.status === 'executed')
      await coreUpdate({ ...ctx, broadcast: (message) => ctx.hub.broadcast(message) }, record, result.body);
  }
  // Null: the Hub's sweep finished this request first and told the call (first finish wins, ADR-020).
  if (!record) return null;
  await send(ctx, record.run_id, record.last_event);
  return record;
}
