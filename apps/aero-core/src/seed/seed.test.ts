import {
  ActionIdSchema,
  CoreTransactionSchema,
  HalynError,
  IdSchema,
  parseActionParams,
} from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import committedSeedSql from '../../seed/seed.sql?raw';
import { rows, testEnv, uniqueCustomer } from '../../test/fixtures/env';
import {
  buildSeedSql,
  customerRows,
  DEMO_CUSTOMERS,
  SEED_FACTS,
  SEED_TENANT,
  seedRows,
  seedStatements,
  sqlValue,
} from './index';

describe('seed/seed.sql', () => {
  it('is exactly what the seed module generates (run `pnpm seed:core --write-only` after changing it)', () => {
    expect(committedSeedSql.replaceAll('\r\n', '\n')).toBe(buildSeedSql());
  });

  it('holds no phone number (only last-4 digits and ids)', () => {
    expect(buildSeedSql()).not.toMatch(/\+\d{7,15}|\b\d{10,18}\b(?!_)/);
  });

  it('is deterministic', () => {
    expect(buildSeedSql()).toBe(buildSeedSql());
    expect(seedRows(DEMO_CUSTOMERS)).toEqual(seedRows(DEMO_CUSTOMERS));
  });
});

describe('demo seed facts (the scenarios run against these)', () => {
  const demo = seedRows(DEMO_CUSTOMERS);
  const params = (action: string, p: unknown) => parseActionParams(ActionIdSchema.parse(action), p).ok;

  it('IN: card 8812, the ₹600 fee, the loan with EMI on the 5th, payees Mom and Landlord', () => {
    const mine = (r: { customer_ref: string }) => r.customer_ref === 'cus_saksham';
    expect(demo.accounts.filter(mine)).toMatchObject([
      {
        type: 'savings',
        currency: 'INR',
        balance_minor: 52_000_000,
        is_primary: true,
        tenant_id: SEED_TENANT,
      },
    ]);
    expect(demo.cards.filter(mine)).toMatchObject([{ last4: '8812', status: 'active' }]);
    expect(demo.fees.filter(mine)).toMatchObject([
      { id: 'fee_late_oct', amount_minor: 60_000, currency: 'INR', status: 'due' },
    ]);
    expect(demo.loans.filter(mine)).toMatchObject([{ id: 'loan_personal_1', emi_day: 5, status: 'active' }]);
    expect(demo.payees.filter(mine).map((p) => [p.id, p.name, p.saved])).toEqual([
      ['payee_mom', 'Mom', true],
      ['payee_landlord', 'Landlord', true],
    ]);
  });

  it('every account carries only its last 4 digits and every loan an outstanding of its own', () => {
    for (const a of demo.accounts) expect(a.last4).toMatch(/^[0-9]{4}$/);
    for (const l of demo.loans) {
      expect(Number.isInteger(l.outstanding_minor)).toBe(true);
      expect(l.outstanding_minor).toBeGreaterThan(l.emi_minor);
    }
  });

  it('US twin: a USD checking account, card 2207, the $35 fee, a saved landlord, no loan', () => {
    const twin = (r: { customer_ref: string }) => r.customer_ref === 'cus_saksham_us';
    expect(demo.accounts.filter(twin)).toMatchObject([
      { type: 'checking', currency: 'USD', balance_minor: 1_245_000 },
    ]);
    expect(demo.cards.filter(twin)).toMatchObject([{ last4: '2207' }]);
    expect(demo.fees.filter(twin)).toMatchObject([
      { id: 'fee_us_late_oct', amount_minor: 3_500, currency: 'USD' },
    ]);
    expect(demo.loans.filter(twin)).toEqual([]);
    expect(demo.payees.filter(twin).map((p) => p.id)).toEqual(['payee_us_landlord']);
  });

  it('every id a scenario sends as a param is a valid param', () => {
    expect(
      params('fee.waive', {
        amount_minor: SEED_FACTS.IN.fee.amount_minor,
        currency: 'INR',
        fee_id: SEED_FACTS.IN.fee.id,
      }),
    ).toBe(true);
    expect(params('emi.move_date', { loan_id: SEED_FACTS.IN.loan.id, new_day: 10 })).toBe(true);
    for (const payee_id of [...SEED_FACTS.IN.payees, ...SEED_FACTS.US.payees])
      expect(params('transfer.saved', { amount_minor: 1, currency: 'INR', payee_id })).toBe(true);
  });

  it('every row id is a Halyn id (≤ 64 chars) and every seeded line is a valid statement line', () => {
    const all = seedRows([
      ...DEMO_CUSTOMERS,
      { tenant: SEED_TENANT, customer: uniqueCustomer(), region: 'IN' },
    ]);
    for (const row of [
      ...all.accounts,
      ...all.cards,
      ...all.fees,
      ...all.loans,
      ...all.payees,
      ...all.transactions,
    ])
      expect(IdSchema.safeParse(row.id).success, row.id).toBe(true);
    for (const t of all.transactions)
      expect(
        CoreTransactionSchema.safeParse({
          id: t.id,
          kind: t.kind,
          category: t.category,
          amount: { amount_minor: t.amount_minor, currency: t.currency },
          description: t.description,
          payee_id: t.payee_id ?? null,
          reference: t.reference ?? null,
          created_at: t.created_at,
        }).success,
        t.id,
      ).toBe(true);
  });

  it('derives internal ids from the customer, so customers never collide', () => {
    const a = customerRows({ tenant: SEED_TENANT, customer: 'cus_a', region: 'IN' });
    const b = customerRows({ tenant: SEED_TENANT, customer: 'cus_b', region: 'IN' });
    expect(a.accounts[0]?.id).toBe('acc_a_savings');
    expect(b.cards[0]?.id).toBe('card_b_debit');
    expect(b.transactions[0]?.id).toBe('txn_b_01');
  });
});

describe('seed SQL', () => {
  it.each([
    [null, 'NULL'],
    [undefined, 'NULL'],
    [true, '1'],
    [false, '0'],
    [60000, '60000'],
    ["O'Brien", "'O''Brien'"],
  ])('sqlValue(%j) → %s', (value, sql) => {
    expect(sqlValue(value)).toBe(sql);
  });

  it.each([1.5, Number.NaN, 2 ** 53, {}])('sqlValue(%j) fails closed', (value) => {
    expect(() => sqlValue(value)).toThrow(HalynError);
  });

  it('applies to D1, and re-applying resets the customer’s demo state without touching used_grants', async () => {
    const db = testEnv().DB;
    const customer = uniqueCustomer();
    const run = () =>
      db.batch(seedStatements([{ tenant: SEED_TENANT, customer, region: 'IN' }]).map((s) => db.prepare(s)));
    await run();
    await db.batch([
      db.prepare("UPDATE cards SET status = 'frozen' WHERE customer_ref = ?").bind(customer),
      db
        .prepare(
          "INSERT INTO used_grants (jti, tenant_id, customer_ref, action, request_id, used_at) VALUES (?, 'ten_aero', ?, 'card.freeze', 'req_x', 'now')",
        )
        .bind(`jti_${customer}`, customer),
    ]);
    await run();
    expect(await rows('SELECT status FROM cards WHERE customer_ref = ?', customer)).toEqual([
      { status: 'active' },
    ]);
    expect(await rows('SELECT COUNT(*) AS n FROM transactions WHERE customer_ref = ?', customer)).toEqual([
      { n: 7 },
    ]);
    expect(await rows('SELECT jti FROM used_grants WHERE customer_ref = ?', customer)).toHaveLength(1);
  });
});
