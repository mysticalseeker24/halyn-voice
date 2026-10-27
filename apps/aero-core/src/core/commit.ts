import { type CoreOutcomeDetails, HalynError } from '@halyn/shared';
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { usedGrants } from '../db/schema';
import { type ExecContext, referenceFor } from './context';

// Single use (invariant 1). Every handler runs its effect as ONE D1 batch that starts with `recordGrant` (insert the
// jti into used_grants). D1 runs a batch as a transaction, so a jti that is already there fails the primary key and
// rolls back the whole batch: of N concurrent requests carrying one grant, exactly one writes. A write handler also
// looks the jti up first (in the same round trip as its own reads) so a replay is reported as E_GRANT_REUSED before
// any business check. A failed write leaves no trace, and its grant stays unused.
//
// A batch cannot branch, so a write's precondition (the account is still active, the fee still due, …) is checked
// INSIDE it: `recordGrant(ctx, precondition)` takes used_grants.customer_ref (NOT NULL) from a subquery that yields a
// row only while the precondition holds. If it stopped holding after the handler's read, the first statement fails and
// nothing in the batch applies — no jti, no transaction, no payee.
//
// Only Halyn holds a grant, so E_GRANT_REUSED on Halyn's own retry means "executed earlier", not "refused": the error
// carries the first use (CoreOutcomeDetails `executed`) so the API's core client can reconcile by reference.

export interface UsedGrantRow {
  request_id: string;
  used_at: string;
}

export function usedGrantLookup(ctx: ExecContext) {
  return ctx.db
    .select({ request_id: usedGrants.request_id, used_at: usedGrants.used_at })
    .from(usedGrants)
    .where(and(eq(usedGrants.tenant_id, ctx.tenant), eq(usedGrants.jti, ctx.jti)))
    .limit(1);
}

function executed(ctx: ExecContext, use: UsedGrantRow): CoreOutcomeDetails {
  return {
    outcome: 'executed',
    reference: referenceFor(ctx.jti),
    request_id: use.request_id,
    used_at: use.used_at,
  };
}

function reused(ctx: ExecContext, use: UsedGrantRow): HalynError {
  return new HalynError('E_GRANT_REUSED', 'The grant has already been used', {
    details: executed(ctx, use),
  });
}

export function rejectIfUsed(ctx: ExecContext, rows: readonly UsedGrantRow[]): void {
  const [use] = rows;
  if (use) throw reused(ctx, use);
}

/**
 * The first statement of every effect batch. Writes pass their `precondition`: a select of ONE column (the
 * customer's ref) that returns a row only while the write may still happen. Reads pass none.
 */
export function recordGrant(ctx: ExecContext, precondition?: SQLWrapper) {
  return ctx.db.insert(usedGrants).values({
    jti: ctx.jti,
    tenant_id: ctx.tenant,
    customer_ref: precondition ? sql`${precondition}` : ctx.customer,
    action: ctx.action,
    request_id: ctx.requestId,
    used_at: ctx.now,
  });
}

/**
 * Run an effect batch (which must start with `recordGrant`). If it fails: E_GRANT_REUSED (with the first use) when
 * the jti is recorded now — another request used the grant, or this very batch committed and only its answer was
 * lost; E_FAIL_CLOSED when it is not (nothing was written: a precondition stopped holding, or a constraint such as the
 * balance CHECK refused); E_FAIL_CLOSED with outcome `unknown` when Aero Core cannot even look.
 */
export async function commit<T>(ctx: ExecContext, batch: () => Promise<T>): Promise<T> {
  try {
    return await batch();
  } catch (err) {
    let use: UsedGrantRow | undefined;
    try {
      [use] = await usedGrantLookup(ctx);
    } catch {
      throw new HalynError('E_FAIL_CLOSED', 'The write failed and its outcome could not be checked', {
        cause: err,
        details: { outcome: 'unknown' },
      });
    }
    if (use) throw reused(ctx, use);
    throw new HalynError('E_FAIL_CLOSED', 'The bank refused the write; nothing was changed', { cause: err });
  }
}

/**
 * The batch committed but did not return the row the answer needs. Unreachable while the precondition holds (the row
 * exists inside the same transaction), but if it happens the write DID happen: say so, with the reference.
 */
export function committedWithoutResult(ctx: ExecContext): HalynError {
  return new HalynError('E_FAIL_CLOSED', 'The write was committed, but its result could not be read', {
    details: executed(ctx, { request_id: ctx.requestId, used_at: ctx.now }),
  });
}
