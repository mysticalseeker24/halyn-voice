import { type CoreResponse, HalynError } from '@halyn/shared';
import { and, eq, exists, gte, sql } from 'drizzle-orm';
import { accounts, payees, transactions } from '../db/schema';
import type { CoreProposal } from '../grant/require-grant';
import { commit, committedWithoutResult, recordGrant, rejectIfUsed, usedGrantLookup } from './commit';
import { type ExecContext, referenceFor } from './context';

// POST /core/transfers executes three actions (the grant's verified action picks one):
//   transfer.saved      → an existing saved payee (payee_id)
//   transfer.new_payee  → adds an unsaved payee (account last 4 + IFSC, optional name), then pays it
//   wire.new            → adds an unsaved payee (account last 4 + routing last 4), then wires to it
// The money leaves the customer's primary account in the transfer's currency. Balances never go negative: refused
// up front, re-checked inside the batch (the precondition), and the accounts CHECK (balance_minor >= 0) is the
// backstop. The precondition also requires the account to be the same active primary account in the transfer's
// currency and, for transfer.saved, the payee to be still saved — whatever changed after the read, nothing is written.

export type TransferProposal = Extract<
  CoreProposal,
  { action: 'transfer.new_payee' | 'transfer.saved' | 'wire.new' }
>;

function primaryAccountLookup(ctx: ExecContext, currency: string) {
  return ctx.db
    .select({ id: accounts.id, balance_minor: accounts.balance_minor, status: accounts.status })
    .from(accounts)
    .where(
      and(
        eq(accounts.tenant_id, ctx.tenant),
        eq(accounts.customer_ref, ctx.customer),
        eq(accounts.currency, currency as 'INR' | 'USD'),
        eq(accounts.is_primary, true),
      ),
    )
    .limit(1);
}

const payeeIs = (ctx: ExecContext, payeeId: string) =>
  and(eq(payees.tenant_id, ctx.tenant), eq(payees.customer_ref, ctx.customer), eq(payees.id, payeeId));

async function readState(ctx: ExecContext, currency: string, payeeId: string | null) {
  const { db } = ctx;
  if (payeeId === null) {
    const [used, account] = await db.batch([usedGrantLookup(ctx), primaryAccountLookup(ctx, currency)]);
    return { used, account: account[0], payee: undefined };
  }
  const [used, account, payee] = await db.batch([
    usedGrantLookup(ctx),
    primaryAccountLookup(ctx, currency),
    db
      .select({ id: payees.id, name: payees.name, saved: payees.saved })
      .from(payees)
      .where(payeeIs(ctx, payeeId))
      .limit(1),
  ]);
  return { used, account: account[0], payee: payee[0] };
}

/** Inside the batch: the same active primary account, in this currency, still holding the amount (+ the saved payee). */
function precondition(
  ctx: ExecContext,
  accountId: string,
  currency: 'INR' | 'USD',
  amount: number,
  savedPayee: string | null,
) {
  return ctx.db
    .select({ customer_ref: accounts.customer_ref })
    .from(accounts)
    .where(
      and(
        eq(accounts.tenant_id, ctx.tenant),
        eq(accounts.customer_ref, ctx.customer),
        eq(accounts.id, accountId),
        eq(accounts.currency, currency),
        eq(accounts.is_primary, true),
        eq(accounts.status, 'active'),
        gte(accounts.balance_minor, amount),
        savedPayee === null
          ? undefined
          : exists(
              ctx.db
                .select({ one: sql`1` })
                .from(payees)
                .where(and(payeeIs(ctx, savedPayee), eq(payees.saved, true))),
            ),
      ),
    )
    .limit(1);
}

export async function transfer(
  ctx: ExecContext,
  proposed: TransferProposal,
): Promise<CoreResponse<TransferProposal['action']>> {
  const { db } = ctx;
  const { amount_minor, currency } = proposed.params;
  const saved = proposed.action === 'transfer.saved' ? proposed.params.payee_id : null;
  const state = await readState(ctx, currency, saved);
  rejectIfUsed(ctx, state.used);
  const { account, payee } = state;
  if (!account) throw new HalynError('E_NOT_FOUND', `No ${currency} account for this customer`);
  if (account.status !== 'active') throw new HalynError('E_BAD_REQUEST', 'This account cannot make payments');
  if (account.balance_minor < amount_minor)
    throw new HalynError('E_BAD_REQUEST', 'The balance is too low for this transfer');

  let payeeId: string;
  let description: string;
  let newPayee: typeof payees.$inferInsert | null = null;
  const added = {
    tenant_id: ctx.tenant,
    customer_ref: ctx.customer,
    saved: false,
    added_at: ctx.now,
    added_by_grant: ctx.jti,
  };
  switch (proposed.action) {
    case 'transfer.saved':
      if (!payee?.saved) throw new HalynError('E_NOT_FOUND', `No saved payee ${proposed.params.payee_id}`);
      payeeId = payee.id;
      description = `Transfer to ${payee.name ?? 'saved payee'}`;
      break;
    case 'transfer.new_payee': {
      const p = proposed.params;
      payeeId = ctx.newId('payee');
      description = `Transfer to ${p.payee_name ?? 'new payee'}, account ending ${p.payee_account_last4}`;
      newPayee = {
        ...added,
        id: payeeId,
        name: p.payee_name ?? null,
        account_last4: p.payee_account_last4,
        ifsc: p.payee_ifsc,
        routing_last4: null,
      };
      break;
    }
    case 'wire.new': {
      const p = proposed.params;
      payeeId = ctx.newId('payee');
      description = `Wire to account ending ${p.payee_account_last4}`;
      newPayee = {
        ...added,
        id: payeeId,
        name: null,
        account_last4: p.payee_account_last4,
        ifsc: null,
        routing_last4: p.routing_last4,
      };
      break;
    }
  }

  const reference = referenceFor(ctx.jti);
  const txn = {
    tenant_id: ctx.tenant,
    id: ctx.newId('txn'),
    customer_ref: ctx.customer,
    account_id: account.id,
    kind: 'debit',
    category: proposed.action === 'wire.new' ? 'wire' : 'transfer',
    amount_minor,
    currency,
    description,
    payee_id: payeeId,
    fee_id: null,
    reference,
    grant_jti: ctx.jti,
    created_at: ctx.now,
  } satisfies typeof transactions.$inferInsert;
  const debit = db
    .update(accounts)
    .set({ balance_minor: sql`${accounts.balance_minor} - ${amount_minor}` })
    .where(
      and(
        eq(accounts.tenant_id, ctx.tenant),
        eq(accounts.customer_ref, ctx.customer),
        eq(accounts.id, account.id),
        eq(accounts.currency, currency),
      ),
    )
    .returning({ balance_minor: accounts.balance_minor });
  const insertTxn = db.insert(transactions).values(txn);
  const grant = recordGrant(ctx, precondition(ctx, account.id, currency, amount_minor, saved));

  const after = await commit(ctx, async () => {
    if (!newPayee) return (await db.batch([grant, debit, insertTxn]))[1];
    return (await db.batch([grant, db.insert(payees).values(newPayee), debit, insertTxn]))[2];
  });
  const balance = after[0];
  // The precondition proved the account inside the same transaction, so the debit returned it; this guards the type.
  if (!balance) throw committedWithoutResult(ctx);
  return {
    action: proposed.action,
    reference,
    transaction: {
      id: txn.id,
      kind: txn.kind,
      category: txn.category,
      amount: { amount_minor, currency },
      description,
      payee_id: payeeId,
      reference,
      created_at: ctx.now,
    },
    balance: { amount_minor: balance.balance_minor, currency },
  };
}
