import { HalynError } from '@halyn/shared';
import { and, eq } from 'drizzle-orm';
import { usedGrants } from '../db/schema';
import type { ExecContext } from './context';

// Single use (invariant 1). Every handler runs its effect as ONE D1 batch that starts with `recordGrant` (insert the
// jti into used_grants). D1 runs a batch as a transaction, so a jti that is already there fails the primary key and
// rolls back the whole batch: of N concurrent requests carrying one grant, exactly one writes. A write handler also
// looks the jti up first (in the same round trip as its own reads) so a replay is reported as E_GRANT_REUSED before
// any business check. A failed write leaves no trace, and its grant stays unused.

export function usedGrantLookup(ctx: ExecContext) {
  return ctx.db
    .select({ jti: usedGrants.jti })
    .from(usedGrants)
    .where(and(eq(usedGrants.tenant_id, ctx.tenant), eq(usedGrants.jti, ctx.jti)))
    .limit(1);
}

function reused(): HalynError {
  return new HalynError('E_GRANT_REUSED', 'The grant has already been used');
}

export function rejectIfUsed(rows: readonly unknown[]): void {
  if (rows.length > 0) throw reused();
}

/** The first statement of every effect batch. */
export function recordGrant(ctx: ExecContext) {
  return ctx.db.insert(usedGrants).values({
    jti: ctx.jti,
    tenant_id: ctx.tenant,
    customer_ref: ctx.customer,
    action: ctx.action,
    request_id: ctx.requestId,
    used_at: ctx.now,
  });
}

/**
 * Run an effect batch (which must start with `recordGrant`). If it fails, nothing was written: the error is
 * E_GRANT_REUSED when the jti is now recorded (another request used the grant first), otherwise E_FAIL_CLOSED (e.g. a
 * debit that would overdraw, caught by the balance CHECK).
 */
export async function commit<T>(ctx: ExecContext, batch: () => Promise<T>): Promise<T> {
  try {
    return await batch();
  } catch (err) {
    const used = await usedGrantLookup(ctx);
    if (used.length > 0) throw reused();
    throw new HalynError('E_FAIL_CLOSED', 'The bank refused the write; nothing was changed', { cause: err });
  }
}
