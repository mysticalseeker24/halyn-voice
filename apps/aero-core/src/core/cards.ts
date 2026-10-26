import { type ActionParams, type CoreResponse, HalynError } from '@halyn/shared';
import { and, eq } from 'drizzle-orm';
import { cards } from '../db/schema';
import { commit, recordGrant, rejectIfUsed, usedGrantLookup } from './commit';
import { type ExecContext, referenceFor } from './context';

/** card.freeze — protective and idempotent: freezing a frozen card succeeds (and still uses the grant). */
export async function freezeCard(
  ctx: ExecContext,
  params: ActionParams<'card.freeze'>,
): Promise<CoreResponse<'card.freeze'>> {
  const { db } = ctx;
  const [used, found] = await db.batch([
    usedGrantLookup(ctx),
    db
      .select({ id: cards.id, status: cards.status, frozen_at: cards.frozen_at })
      .from(cards)
      .where(
        and(
          eq(cards.tenant_id, ctx.tenant),
          eq(cards.customer_ref, ctx.customer),
          eq(cards.last4, params.card_last4),
        ),
      )
      .limit(1),
  ]);
  rejectIfUsed(used);
  const card = found[0];
  if (!card) throw new HalynError('E_NOT_FOUND', `No card ending ${params.card_last4} for this customer`);

  await commit(ctx, () =>
    db.batch([
      recordGrant(ctx),
      db
        .update(cards)
        .set({ status: 'frozen', frozen_at: card.frozen_at ?? ctx.now, updated_by_grant: ctx.jti })
        .where(
          and(eq(cards.tenant_id, ctx.tenant), eq(cards.customer_ref, ctx.customer), eq(cards.id, card.id)),
        ),
    ]),
  );
  return {
    action: 'card.freeze',
    reference: referenceFor(ctx.jti),
    card: { last4: params.card_last4, status: 'frozen' },
    already_frozen: card.status === 'frozen',
  };
}
