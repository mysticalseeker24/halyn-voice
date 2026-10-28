import { type ActionParams, type CoreResponse, type CoreTransaction, HalynError } from '@halyn/shared';
import { and, desc, eq } from 'drizzle-orm';
import { accounts, cards, loans, transactions } from '../db/schema';
import { commit, recordGrant } from './commit';
import type { ExecContext } from './context';

// Reads need a grant too (statement.view and balance.view are actions like any other). A read grant is used by the
// read: the jti is recorded in the same batch that reads, so it cannot be replayed even when the account is missing.

export const STATEMENT_LINES = 20;

function accountByType(ctx: ExecContext, type: ActionParams<'balance.view'>['account']) {
  return ctx.db
    .select({
      id: accounts.id,
      balance_minor: accounts.balance_minor,
      currency: accounts.currency,
      last4: accounts.last4,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.tenant_id, ctx.tenant),
        eq(accounts.customer_ref, ctx.customer),
        eq(accounts.type, type),
      ),
    )
    .limit(1);
}

function noAccount(type: string): HalynError {
  return new HalynError('E_NOT_FOUND', `No ${type} account for this customer`);
}

export async function viewBalance(
  ctx: ExecContext,
  params: ActionParams<'balance.view'>,
): Promise<CoreResponse<'balance.view'>> {
  const [, found] = await commit(ctx, () =>
    ctx.db.batch([recordGrant(ctx), accountByType(ctx, params.account)]),
  );
  const account = found[0];
  if (!account) throw noAccount(params.account);
  return {
    action: 'balance.view',
    account: params.account,
    balance: { amount_minor: account.balance_minor, currency: account.currency },
    as_of: ctx.now,
  };
}

export async function viewStatement(
  ctx: ExecContext,
  params: ActionParams<'statement.view'>,
): Promise<CoreResponse<'statement.view'>> {
  const { db } = ctx;
  const [, found, lines, cardRows, loanRows] = await commit(ctx, () =>
    db.batch([
      recordGrant(ctx),
      accountByType(ctx, params.account),
      db
        .select({
          id: transactions.id,
          kind: transactions.kind,
          category: transactions.category,
          amount_minor: transactions.amount_minor,
          currency: transactions.currency,
          description: transactions.description,
          payee_id: transactions.payee_id,
          reference: transactions.reference,
          created_at: transactions.created_at,
        })
        .from(transactions)
        .innerJoin(
          accounts,
          and(eq(accounts.tenant_id, transactions.tenant_id), eq(accounts.id, transactions.account_id)),
        )
        .where(
          and(
            eq(transactions.tenant_id, ctx.tenant),
            eq(transactions.customer_ref, ctx.customer),
            eq(accounts.customer_ref, ctx.customer),
            eq(accounts.type, params.account),
          ),
        )
        .orderBy(desc(transactions.created_at), desc(transactions.id))
        .limit(STATEMENT_LINES),
      db
        .select({ last4: cards.last4, status: cards.status })
        .from(cards)
        .where(and(eq(cards.tenant_id, ctx.tenant), eq(cards.customer_ref, ctx.customer)))
        .orderBy(cards.last4)
        .limit(10),
      db
        .select({
          id: loans.id,
          emi_minor: loans.emi_minor,
          outstanding_minor: loans.outstanding_minor,
          currency: loans.currency,
          emi_day: loans.emi_day,
          status: loans.status,
        })
        .from(loans)
        .where(and(eq(loans.tenant_id, ctx.tenant), eq(loans.customer_ref, ctx.customer)))
        .orderBy(loans.id)
        .limit(10),
    ]),
  );
  const account = found[0];
  if (!account) throw noAccount(params.account);
  return {
    action: 'statement.view',
    account: params.account,
    account_last4: account.last4,
    balance: { amount_minor: account.balance_minor, currency: account.currency },
    transactions: lines.map((t): CoreTransaction => ({
      id: t.id,
      kind: t.kind,
      category: t.category,
      amount: { amount_minor: t.amount_minor, currency: t.currency },
      description: t.description,
      payee_id: t.payee_id,
      reference: t.reference,
      created_at: t.created_at,
    })),
    cards: cardRows.map((c) => ({ last4: c.last4, status: c.status })),
    loans: loanRows.map((l) => ({
      id: l.id,
      emi: { amount_minor: l.emi_minor, currency: l.currency },
      emi_day: l.emi_day,
      outstanding: { amount_minor: l.outstanding_minor, currency: l.currency },
      status: l.status,
    })),
    as_of: ctx.now,
  };
}
