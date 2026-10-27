import { CoreOutcomeDetailsSchema, HalynError } from '@halyn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, testEnv, uniqueCustomer } from '../../test/fixtures/env';
import { ulid } from '../../test/fixtures/grants';
import { createDb, type CoreDb } from '../db/client';
import { accounts, cards } from '../db/schema';
import { commit, committedWithoutResult, recordGrant, rejectIfUsed, usedGrantLookup } from './commit';
import type { ExecContext } from './context';

function ctx(overrides: Partial<ExecContext> = {}): ExecContext {
  return {
    db: createDb(testEnv().DB),
    tenant: 'ten_aero',
    customer: uniqueCustomer(),
    jti: ulid(),
    requestId: `req_${ulid()}`,
    action: 'card.freeze',
    now: '2026-10-27T04:30:00.000Z',
    newId: (prefix) => `${prefix}_${ulid()}`,
    ...overrides,
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

/** The executed-outcome details a REUSED (or post-commit) error carries for this context's grant. */
const executed = (c: ExecContext) => ({
  outcome: 'executed',
  reference: `AERO-${c.jti.slice(-6)}`,
  request_id: c.requestId,
  used_at: c.now,
});

describe('commit: one atomic batch per grant (invariant 1)', () => {
  it('records the grant together with the effect and returns the batch results', async () => {
    const c = ctx();
    const [, used] = await commit(c, () => c.db.batch([recordGrant(c), usedGrantLookup(c)]));
    expect(used).toEqual([{ request_id: c.requestId, used_at: c.now }]);
    expect(
      await rows('SELECT tenant_id, customer_ref, action, request_id FROM used_grants WHERE jti = ?', c.jti),
    ).toEqual([
      { tenant_id: 'ten_aero', customer_ref: c.customer, action: 'card.freeze', request_id: c.requestId },
    ]);
  });

  it('a second batch with the same jti fails as a whole → E_GRANT_REUSED with the first use as details', async () => {
    const first = ctx();
    await commit(first, () => first.db.batch([recordGrant(first)]));
    // The retry carries the same grant (jti, request) but runs later: the details are the FIRST use.
    const retry = { ...first, now: '2026-10-27T04:31:00.000Z' };
    const err = await failure(
      commit(retry, () => retry.db.batch([recordGrant(retry), usedGrantLookup(retry)])),
    );
    expect(err.code).toBe('E_GRANT_REUSED');
    expect(err.details).toEqual(executed(first));
    expect(CoreOutcomeDetailsSchema.parse(err.details)).toEqual(executed(first));
  });

  it('any other failure rolls back the grant too → E_FAIL_CLOSED, and the jti stays unused', async () => {
    const c = ctx();
    const err = await failure(commit(c, () => c.db.batch([recordGrant(c), badInsert(c)])));
    expect(err.code).toBe('E_FAIL_CLOSED');
    expect(err.details).toBeUndefined();
    expect(err.cause).toBeDefined();
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', c.jti)).toEqual([]);
  });

  it('a failed batch whose outcome cannot be checked → E_FAIL_CLOSED with outcome "unknown"', async () => {
    const lookupDown = new Proxy(createDb(testEnv().DB), {
      get(target, prop, receiver) {
        if (prop === 'select')
          return () => {
            throw new Error('D1 unreachable');
          };
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const c = ctx({ db: lookupDown });
    const err = await failure(
      commit(c, () => Promise.reject(new Error('network reset while the batch was in flight'))),
    );
    expect(err.code).toBe('E_FAIL_CLOSED');
    expect(err.details).toEqual({ outcome: 'unknown' });
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('rejectIfUsed throws E_GRANT_REUSED (with the first use) only when the lookup found the jti', () => {
    const c = ctx();
    expect(() => rejectIfUsed(c, [])).not.toThrow();
    const row = { request_id: c.requestId, used_at: '2026-10-27T04:00:00.000Z' };
    expect(() => rejectIfUsed(c, [row])).toThrow(
      expect.objectContaining({ code: 'E_GRANT_REUSED', details: { ...executed(c), used_at: row.used_at } }),
    );
  });

  it('committedWithoutResult says the write happened (outcome executed), never "nothing changed"', () => {
    const c = ctx();
    const err = committedWithoutResult(c);
    expect(err.code).toBe('E_FAIL_CLOSED');
    expect(err.details).toEqual(executed(c));
    expect(err.message).not.toMatch(/nothing/i);
  });
});

describe('recordGrant with a precondition (atomic: D1 batches cannot branch)', () => {
  const activeAccount = (db: CoreDb, c: ExecContext) =>
    db
      .select({ ref: accounts.customer_ref })
      .from(accounts)
      .where(
        and(
          eq(accounts.tenant_id, c.tenant),
          eq(accounts.customer_ref, c.customer),
          eq(accounts.status, 'active'),
        ),
      )
      .limit(1);

  it('embeds the precondition as a subquery feeding used_grants.customer_ref', () => {
    const c = ctx();
    const query = recordGrant(c, activeAccount(c.db, c)).toSQL();
    expect(query.sql).toMatch(
      /values \(\?, \?, \(select "customer_ref" from "accounts" where .+ limit \?\), \?/,
    );
  });

  it('holds → the batch commits and records the customer', async () => {
    const c = ctx({ customer: await seedCustomer() });
    await commit(c, () => c.db.batch([recordGrant(c, activeAccount(c.db, c))]));
    expect(await rows('SELECT customer_ref FROM used_grants WHERE jti = ?', c.jti)).toEqual([
      { customer_ref: c.customer },
    ]);
  });

  it('no longer holds → the first statement fails, the whole batch rolls back: E_FAIL_CLOSED, nothing written', async () => {
    const c = ctx({ customer: await seedCustomer() });
    await testEnv()
      .DB.prepare("UPDATE accounts SET status = 'blocked' WHERE customer_ref = ?")
      .bind(c.customer)
      .run();
    const err = await failure(
      commit(c, () =>
        c.db.batch([
          recordGrant(c, activeAccount(c.db, c)),
          c.db.update(accounts).set({ balance_minor: 0 }).where(eq(accounts.customer_ref, c.customer)),
        ]),
      ),
    );
    expect(err.code).toBe('E_FAIL_CLOSED');
    expect(String((err.cause as Error).message)).toMatch(
      /NOT NULL constraint failed: used_grants\.customer_ref/,
    );
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', c.jti)).toEqual([]);
    expect(await rows('SELECT balance_minor FROM accounts WHERE customer_ref = ?', c.customer)).not.toEqual([
      { balance_minor: 0 },
    ]);
  });
});
