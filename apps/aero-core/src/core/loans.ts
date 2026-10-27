import { type ActionParams, type CoreResponse, HalynError } from '@halyn/shared';
import { and, eq } from 'drizzle-orm';
import { loans } from '../db/schema';
import { commit, recordGrant, rejectIfUsed, usedGrantLookup } from './commit';
import { type ExecContext, referenceFor } from './context';

/**
 * emi.move_date — moves an active loan's EMI to another day of the month (1–28). The batch's precondition is that the
 * loan is still active and still on the day read first, so `previous_emi_day` in the answer is exactly what changed.
 */
export async function moveEmiDate(
  ctx: ExecContext,
  params: ActionParams<'emi.move_date'>,
): Promise<CoreResponse<'emi.move_date'>> {
  const { db } = ctx;
  const where = and(
    eq(loans.tenant_id, ctx.tenant),
    eq(loans.customer_ref, ctx.customer),
    eq(loans.id, params.loan_id),
  );
  const [used, found] = await db.batch([
    usedGrantLookup(ctx),
    db.select({ emi_day: loans.emi_day, status: loans.status }).from(loans).where(where).limit(1),
  ]);
  rejectIfUsed(ctx, used);
  const loan = found[0];
  if (!loan) throw new HalynError('E_NOT_FOUND', `No loan ${params.loan_id} for this customer`);
  if (loan.status !== 'active') throw new HalynError('E_BAD_REQUEST', 'This loan is closed');

  const unchanged = and(where, eq(loans.status, 'active'), eq(loans.emi_day, loan.emi_day));
  await commit(ctx, () =>
    db.batch([
      recordGrant(ctx, db.select({ customer_ref: loans.customer_ref }).from(loans).where(unchanged).limit(1)),
      db
        .update(loans)
        .set({ emi_day: params.new_day, updated_at: ctx.now, updated_by_grant: ctx.jti })
        .where(unchanged),
    ]),
  );
  return {
    action: 'emi.move_date',
    reference: referenceFor(ctx.jti),
    loan: { id: params.loan_id, emi_day: params.new_day, previous_emi_day: loan.emi_day },
  };
}
