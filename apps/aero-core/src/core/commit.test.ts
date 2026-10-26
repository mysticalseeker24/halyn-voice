import { HalynError } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { rows, testEnv, uniqueCustomer } from '../../test/fixtures/env';
import { ulid } from '../../test/fixtures/grants';
import { createDb } from '../db/client';
import { cards } from '../db/schema';
import { commit, recordGrant, rejectIfUsed, usedGrantLookup } from './commit';
import type { ExecContext } from './context';

function ctx(jti = ulid()): ExecContext {
  return {
    db: createDb(testEnv().DB),
    tenant: 'ten_aero',
    customer: uniqueCustomer(),
    jti,
    requestId: `req_${ulid()}`,
    action: 'card.freeze',
    now: '2026-10-27T04:30:00.000Z',
    newId: (prefix) => `${prefix}_${ulid()}`,
  };
}

async function failure(promise: Promise<unknown>): Promise<HalynError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HalynError) return err;
    throw err;
  }
  throw new Error('expected a HalynError');
}

const badInsert = (c: ExecContext) =>
  // A CHECK violation (last4 must be 4 characters): a statement that always fails after the grant insert.
  c.db.insert(cards).values({
    tenant_id: c.tenant,
    id: 'card_x',
    customer_ref: c.customer,
    account_id: 'a',
    last4: 'x',
    status: 'active',
  });

describe('commit: one atomic batch per grant (invariant 1)', () => {
  it('records the grant together with the effect and returns the batch results', async () => {
    const c = ctx();
    const [, used] = await commit(c, () => c.db.batch([recordGrant(c), usedGrantLookup(c)]));
    expect(used).toEqual([{ jti: c.jti }]);
    expect(
      await rows('SELECT tenant_id, customer_ref, action, request_id FROM used_grants WHERE jti = ?', c.jti),
    ).toEqual([
      { tenant_id: 'ten_aero', customer_ref: c.customer, action: 'card.freeze', request_id: c.requestId },
    ]);
  });

  it('a second batch with the same jti fails as a whole → E_GRANT_REUSED', async () => {
    const c = ctx();
    await commit(c, () => c.db.batch([recordGrant(c)]));
    const err = await failure(commit(c, () => c.db.batch([recordGrant(c), usedGrantLookup(c)])));
    expect(err.code).toBe('E_GRANT_REUSED');
  });

  it('any other failure rolls back the grant too → E_FAIL_CLOSED, and the jti stays unused', async () => {
    const c = ctx();
    const err = await failure(commit(c, () => c.db.batch([recordGrant(c), badInsert(c)])));
    expect(err.code).toBe('E_FAIL_CLOSED');
    expect(err.cause).toBeDefined();
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', c.jti)).toEqual([]);
  });

  it('rejectIfUsed throws E_GRANT_REUSED only when the lookup found the jti', () => {
    expect(() => rejectIfUsed([])).not.toThrow();
    expect(() => rejectIfUsed([{ jti: 'x' }])).toThrow(expect.objectContaining({ code: 'E_GRANT_REUSED' }));
  });
});
