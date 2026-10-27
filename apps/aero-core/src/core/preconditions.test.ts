import { type CoreActionId, HalynError } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, TENANT, testEnv } from '../../test/fixtures/env';
import { ulid } from '../../test/fixtures/grants';
import { type CoreDb, createDb } from '../db/client';
import type { Region } from '../seed';
import type { CoreProposal } from '../grant/require-grant';
import type { ExecContext } from './context';
import { execute } from './execute';

// Every write reads first (one round trip), then runs ONE D1 batch. A batch cannot branch, so each write's precondition
// is checked INSIDE the batch: the first statement (the used_grants insert) takes customer_ref from a subquery that
// yields a row only while the precondition holds. Here the precondition stops holding between the read and the batch
// (another writer got there first): the batch must write nothing at all — no jti, no transaction, no payee, no change.

const NOW = '2026-10-27T04:30:00.000Z';
const SAVED = { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' };
const NEW_PAYEE = {
  amount_minor: 4500000,
  currency: 'INR',
  payee_account_last4: '4471',
  payee_ifsc: 'AERO0000001',
};
const WIRE = { amount_minor: 800000, currency: 'USD', payee_account_last4: '3310', routing_last4: '0021' };
const FEE = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
const FREEZE = { card_last4: '8812' };
const EMI = { loan_id: 'loan_personal_1', new_day: 10 };

/** A database whose SECOND batch (the effect; the first is the read) runs `between` first. */
function racingDb(between: () => Promise<void>): CoreDb {
  let batches = 0;
  return new Proxy(createDb(testEnv().DB), {
    get(target, prop, receiver) {
      if (prop === 'batch')
        return async (queries: Parameters<CoreDb['batch']>[0]) => {
          batches += 1;
          if (batches === 2) await between();
          return target.batch(queries);
        };
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

async function snapshot(sub: string) {
  const all = (table: string) => rows(`SELECT * FROM ${table} WHERE customer_ref = ? ORDER BY id`, sub);
  return {
    accounts: await all('accounts'),
    cards: await all('cards'),
    fees: await all('fees'),
    loans: await all('loans'),
    payees: await all('payees'),
    transactions: await all('transactions'),
  };
}

const run = (sql: string, ...binds: unknown[]) =>
  testEnv()
    .DB.prepare(sql)
    .bind(...binds)
    .run();

type Case = [string, Region, CoreActionId, Record<string, unknown>, string];

const cases: Case[] = [
  [
    'transfer.saved: the account was blocked',
    'IN',
    'transfer.saved',
    SAVED,
    "UPDATE accounts SET status = 'blocked'",
  ],
  ['transfer.saved: the account vanished', 'IN', 'transfer.saved', SAVED, 'DELETE FROM accounts'],
  [
    'transfer.saved: the balance dropped below the amount',
    'IN',
    'transfer.saved',
    SAVED,
    'UPDATE accounts SET balance_minor = 100',
  ],
  [
    'transfer.saved: the payee is no longer saved',
    'IN',
    'transfer.saved',
    SAVED,
    'UPDATE payees SET saved = 0',
  ],
  ['transfer.saved: the payee vanished', 'IN', 'transfer.saved', SAVED, 'DELETE FROM payees'],
  [
    'transfer.new_payee: the account was blocked',
    'IN',
    'transfer.new_payee',
    NEW_PAYEE,
    "UPDATE accounts SET status = 'blocked'",
  ],
  ['wire.new: the account vanished', 'US', 'wire.new', WIRE, 'DELETE FROM accounts'],
  ['fee.waive: the fee was waived meanwhile', 'IN', 'fee.waive', FEE, "UPDATE fees SET status = 'waived'"],
  ['fee.waive: the fee vanished', 'IN', 'fee.waive', FEE, 'DELETE FROM fees'],
  ['fee.waive: the account vanished', 'IN', 'fee.waive', FEE, 'DELETE FROM accounts'],
  [
    'fee.waive: the account is now in another currency',
    'IN',
    'fee.waive',
    FEE,
    "UPDATE accounts SET currency = 'USD'",
  ],
  ['card.freeze: the card vanished', 'IN', 'card.freeze', FREEZE, 'DELETE FROM cards'],
  ['emi.move_date: the loan was closed', 'IN', 'emi.move_date', EMI, "UPDATE loans SET status = 'closed'"],
  ['emi.move_date: the loan vanished', 'IN', 'emi.move_date', EMI, 'DELETE FROM loans'],
  ['emi.move_date: another move landed first', 'IN', 'emi.move_date', EMI, 'UPDATE loans SET emi_day = 7'],
];

function context(sub: string, action: CoreActionId, db: CoreDb): ExecContext {
  return {
    db,
    tenant: TENANT,
    customer: sub,
    jti: ulid(),
    requestId: `req_${ulid()}`,
    action,
    now: NOW,
    newId: (prefix) => `${prefix}_${ulid()}`,
  };
}

describe('a write precondition that stops holding between the read and the batch', () => {
  it.each(cases)('%s → E_FAIL_CLOSED, nothing written', async (_, region, action, params, mutation) => {
    const sub = await seedCustomer(region);
    let before: Awaited<ReturnType<typeof snapshot>> | undefined;
    const db = racingDb(async () => {
      await run(`${mutation} WHERE customer_ref = ?`, sub);
      before = await snapshot(sub);
    });
    const ctx = context(sub, action, db);
    const err = await execute(ctx, { action, params } as CoreProposal).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HalynError);
    expect(err).toMatchObject({ code: 'E_FAIL_CLOSED', details: undefined });
    expect(before).toBeDefined();
    expect(await snapshot(sub)).toEqual(before);
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', ctx.jti)).toEqual([]);
  });

  it('control: when nothing changes in between, the same harness executes the write', async () => {
    const sub = await seedCustomer();
    const ctx = context(
      sub,
      'transfer.saved',
      racingDb(() => Promise.resolve()),
    );
    const body = await execute(ctx, { action: 'transfer.saved', params: SAVED } as CoreProposal);
    expect(body).toMatchObject({ reference: `AERO-${ctx.jti.slice(-6)}` });
    expect(await rows('SELECT customer_ref FROM used_grants WHERE jti = ?', ctx.jti)).toEqual([
      { customer_ref: sub },
    ]);
  });
});
