import { type ActionParams, type CoreResponse, type CoreTransaction, HalynError } from '@halyn/shared';
import { and, desc, eq } from 'drizzle-orm';
import { accounts, transactions } from '../db/schema';
import { commit, recordGrant } from './commit';
import type { ExecContext } from './context';

// Reads need a grant too (statement.view and balance.view are actions like any other). A read grant is used by the
// read: the jti is recorded in the same batch that reads, so it cannot be replayed even when the account is missing.

export const STATEMENT_LINES = 20;

function accountByType(ctx: ExecContext, type: ActionParams<'balance.view'>['account']) {
  return ctx.db
    .select({ id: accounts.id, balance_minor: accounts.balance_minor, currency: accounts.currency })
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
  const [, found, lines] = await commit(ctx, () =>
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
    ]),
  );
  const account = found[0];
  if (!account) throw noAccount(params.account);
  return {
    action: 'statement.view',
    account: params.account,
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
    as_of: ctx.now,
  };
}
