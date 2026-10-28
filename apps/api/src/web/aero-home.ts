import {
  ActionIdSchema,
  type AeroAlert,
  AeroHomeSchema,
  HalynError,
  newId,
  type PendingApproval,
  type ReasonCode,
} from '@halyn/shared';
import type { Context } from 'hono';
import { type AppDeps, flowContext } from '../flow/context';
import { primaryAccount, readStatement } from '../flow/execute';
import type { AppEnv } from '../http/app-env';
import { primaryReason } from '../hub/call-context';
import type { RequestRecord } from '../hub/types';

// GET /web/aero/home (customer session): the Aero app's home. Balance, activity, card and loan come from Aero Core's
// statement with a Halyn grant (every Aero Core read needs one, invariant 1); alerts and pending approvals come from the
// customer's requests in the Hub. Aero Core down → the accounts list is empty and the rest still answers.

const BLOCKED_TITLE: Partial<Record<ReasonCode, string>> = {
  C_DECLINED: 'Stopped: you declined it',
  C_TIMEOUT: 'Stopped: nobody confirmed it',
  S_COACHING: 'Held: a specialist will call you',
  T_DISTRESS: 'Held: a specialist will call you',
  P_HUMAN_ONLY: 'Held for a specialist',
  P_HUMAN_ONLY_ABOVE_LIMIT: 'Held for a specialist',
  H_SPECIALIST: 'Held for a specialist',
  I_NO_PROOF: 'Refused: the caller could not prove who they are',
  R_READBACK_NOT_CONFIRMED: 'Refused: the details were not confirmed',
  E_CORE_REJECTED: 'Not done: the bank refused it',
};

function alertFor(record: RequestRecord): AeroAlert | null {
  const at = new Date(record.created_at).toISOString();
  const base = { id: record.request_id, at, body: record.summary };
  if (record.status === 'awaiting_confirmation')
    return { ...base, kind: 'approval', title: 'Waiting for your approval' };
  if (record.status === 'executed')
    return { ...base, kind: 'info', title: `Done · ${record.execution?.reference ?? ''}`.trim() };
  if (record.status === 'refused' || record.status === 'held' || record.status === 'failed') {
    const reason = record.failure ?? primaryReason(record.decision.reasons);
    return { ...base, kind: 'blocked', title: BLOCKED_TITLE[reason] ?? 'Stopped by Halyn' };
  }
  return null;
}

function pending(record: RequestRecord, now: number): PendingApproval | null {
  if (record.status !== 'awaiting_confirmation' || !record.confirm || record.confirm.deadline <= now)
    return null;
  const action = ActionIdSchema.safeParse(record.action);
  if (!action.success) return null;
  return {
    request_id: record.request_id,
    action: action.data,
    summary: record.summary,
    amount: record.gate.amount,
    channels: record.confirm.channels,
    expires_at: new Date(record.confirm.deadline).toISOString(),
  };
}

export function aeroHome(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const session = c.get('session');
    if (session.kind !== 'customer' || session.customer_id === null)
      throw new HalynError('E_UNAUTHORIZED', 'A customer session is required');
    const flow = flowContext(c.env, session.tenant_id, deps);
    const view = await flow.hub.customerView(session.customer_id);
    if (!view.customer) throw new HalynError('E_NOT_FOUND', 'No such customer');
    const statement = await readStatement(
      flow,
      view.customer.id,
      view.customer.region,
      newId('req', deps.clock, deps.rng),
    );
    const now = deps.clock.nowMs();
    const card = statement?.cards.find((k) => k.status === 'active') ?? statement?.cards[0] ?? null;
    const loan = statement?.loans.find((l) => l.status === 'active') ?? null;
    return c.json(
      AeroHomeSchema.parse({
        customer: { id: view.customer.id, name: view.customer.name },
        accounts: statement
          ? [
              {
                type: statement.account ?? primaryAccount(view.customer.region),
                last4: statement.account_last4,
                balance: statement.balance,
              },
            ]
          : [],
        activity: statement?.transactions ?? [],
        alerts: view.requests.map(alertFor).filter((a): a is AeroAlert => a !== null),
        card,
        loan: loan
          ? { id: loan.id, emi: loan.emi, emi_day: loan.emi_day, outstanding: loan.outstanding }
          : null,
        passkey_registered: view.passkeys > 0,
        pending_approvals: view.requests
          .map((r) => pending(r, now))
          .filter((p): p is PendingApproval => p !== null)
          .slice(0, 10),
      }),
    );
  };
}
