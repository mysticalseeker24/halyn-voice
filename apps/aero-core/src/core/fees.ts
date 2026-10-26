import { type ActionParams, type CoreResponse, HalynError } from '@halyn/shared';
import { and, eq, sql } from 'drizzle-orm';
import { accounts, fees, transactions } from '../db/schema';
import { commit, recordGrant, rejectIfUsed, usedGrantLookup } from './commit';
import { type ExecContext, referenceFor } from './context';

/**
 * fee.waive — credits the fee back to its account and marks it waived. The params must name the fee's exact amount and
 * currency. A fee is credited at most once: a second waiver is refused here, and the unique index on fee_waiver
 * transactions rolls back a racing one.
 */
export async function waiveFee(
  ctx: ExecContext,
  params: ActionParams<'fee.waive'>,
): Promise<CoreResponse<'fee.waive'>> {
  const { db } = ctx;
  const [used, found] = await db.batch([
    usedGrantLookup(ctx),
    db
      .select({
        account_id: fees.account_id,
        description: fees.description,
        amount_minor: fees.amount_minor,
        currency: fees.currency,
        status: fees.status,
      })
      .from(fees)
      .innerJoin(
        accounts,
        and(
          eq(accounts.tenant_id, fees.tenant_id),
          eq(accounts.customer_ref, fees.customer_ref),
          eq(accounts.id, fees.account_id),
        ),
      )
      .where(
        and(eq(fees.tenant_id, ctx.tenant), eq(fees.customer_ref, ctx.customer), eq(fees.id, params.fee_id)),
      )
      .limit(1),
  ]);
  rejectIfUsed(used);
  const fee = found[0];
  if (!fee) throw new HalynError('E_NOT_FOUND', `No fee ${params.fee_id} for this customer`);
  if (fee.status !== 'due') throw new HalynError('E_BAD_REQUEST', 'This fee has already been waived');
  if (fee.amount_minor !== params.amount_minor || fee.currency !== params.currency)
    throw new HalynError('E_BAD_REQUEST', 'The amount does not match the fee');

  const reference = referenceFor(ctx.jti);
  const [, , credited] = await commit(ctx, () =>
    db.batch([
      recordGrant(ctx),
      db
        .update(fees)
        .set({ status: 'waived', waived_at: ctx.now, waived_by_grant: ctx.jti })
        .where(
          and(
            eq(fees.tenant_id, ctx.tenant),
            eq(fees.customer_ref, ctx.customer),
            eq(fees.id, params.fee_id),
            eq(fees.status, 'due'),
          ),
        ),
      db
        .update(accounts)
        .set({ balance_minor: sql`${accounts.balance_minor} + ${params.amount_minor}` })
        .where(
          and(
            eq(accounts.tenant_id, ctx.tenant),
            eq(accounts.customer_ref, ctx.customer),
            eq(accounts.id, fee.account_id),
          ),
        )
        .returning({ balance_minor: accounts.balance_minor, currency: accounts.currency }),
      db.insert(transactions).values({
        tenant_id: ctx.tenant,
        id: ctx.newId('txn'),
        customer_ref: ctx.customer,
        account_id: fee.account_id,
        kind: 'credit',
        category: 'fee_waiver',
        amount_minor: params.amount_minor,
        currency: params.currency,
        description: `Fee waived: ${fee.description}`,
        fee_id: params.fee_id,
        reference,
        grant_jti: ctx.jti,
        created_at: ctx.now,
      }),
    ]),
  );
  const balance = credited[0];
  // The join above proved the account exists, and nothing deletes accounts; this only guards the type.
  if (!balance) throw new HalynError('E_FAIL_CLOSED', 'The fee account disappeared');
  return {
    action: 'fee.waive',
    reference,
    fee: {
      id: params.fee_id,
      status: 'waived',
      amount: { amount_minor: params.amount_minor, currency: params.currency },
    },
    balance: { amount_minor: balance.balance_minor, currency: balance.currency },
  };
}
