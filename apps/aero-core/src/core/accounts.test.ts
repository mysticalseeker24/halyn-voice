import { CORE_RESPONSES } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, testEnv } from '../../test/fixtures/env';
import { mintGrant } from '../../test/fixtures/grants';
import { coreRequest, reply, testApp } from '../../test/fixtures/http';
import { SEED_FACTS } from '../seed';
import { STATEMENT_LINES } from './accounts';

const NOW_MS = Date.UTC(2026, 9, 27, 4, 30, 0);
const NOW_S = NOW_MS / 1000;
const AT = new Date(NOW_MS).toISOString();
const send = testApp(NOW_MS);

async function read(sub: string, action: 'balance.view' | 'statement.view', account = 'savings') {
  const params = { account };
  const grant = await mintGrant({ action, params, sub, iat: NOW_S });
  return { grant, res: await reply(send(coreRequest(action, params, grant.token))) };
}

describe('GET /core/balance (balance.view)', () => {
  it('answers the balance for the grant’s customer, read from the query string', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await read(sub, 'balance.view');
    expect(res.status).toBe(200);
    expect(CORE_RESPONSES['balance.view'].parse(res.body)).toEqual({
      action: 'balance.view',
      account: 'savings',
      balance: { amount_minor: SEED_FACTS.IN.balance_minor, currency: 'INR' },
      as_of: AT,
    });
    expect(await rows('SELECT action FROM used_grants WHERE jti = ?', grant.jti)).toEqual([
      { action: 'balance.view' },
    ]);
  });

  it('an account type the customer lacks → 404, and the read grant is used up', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await read(sub, 'balance.view', 'current');
    expect(res.status).toBe(404);
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', grant.jti)).toHaveLength(1);
  });
});

describe('GET /core/statement (statement.view, scenario 5)', () => {
  it('shows only the last 4 digits of anything: no run of 5+ digits outside amounts, ids and timestamps', async () => {
    const sub = await seedCustomer();
    const { res } = await read(sub, 'statement.view');
    const body = CORE_RESPONSES['statement.view'].parse(res.body);
    expect(body.account_last4).toMatch(/^[0-9]{4}$/);
    expect(body.cards.every((c) => /^[0-9]{4}$/.test(c.last4))).toBe(true);
    // Account numbers would be 9+ digits; nothing in the descriptive fields may look like one.
    const text = [
      ...body.transactions.map((t) => t.description),
      ...body.loans.map((l) => l.id),
      ...body.cards.map((c) => c.last4),
      body.account_last4,
    ].join(' ');
    expect(text).not.toMatch(/[0-9]{5,}/);
  });

  it('lists the account’s lines newest first, with the balance', async () => {
    const sub = await seedCustomer();
    const { res } = await read(sub, 'statement.view');
    expect(res.status).toBe(200);
    const body = CORE_RESPONSES['statement.view'].parse(res.body);
    expect(body.balance).toEqual({ amount_minor: SEED_FACTS.IN.balance_minor, currency: 'INR' });
    expect(body.account_last4).toBe(SEED_FACTS.IN.account_last4);
    expect(body.transactions.map((t) => t.description)).toEqual([
      'Online purchase, card ending 8812',
      'Transfer to Mom',
      'Rent, October',
      'EMI, personal loan',
      'Late payment fee, October',
      'Groceries, card ending 8812',
      'Salary, October',
    ]);
    // Cards and loans ride along (the Aero app's home shows them): last 4 digits and status, EMI and day.
    expect(body.cards).toEqual([{ last4: '8812', status: 'active' }]);
    expect(body.loans).toEqual([
      {
        id: 'loan_personal_1',
        emi: { amount_minor: 1_250_000, currency: 'INR' },
        emi_day: 5,
        outstanding: { amount_minor: SEED_FACTS.IN.loan.outstanding_minor, currency: 'INR' },
        status: 'active',
      },
    ]);
    expect(body.transactions[0]).toEqual({
      id: `txn_${sub.slice(4)}_07`,
      kind: 'debit',
      category: 'card',
      amount: { amount_minor: 129900, currency: 'INR' },
      description: 'Online purchase, card ending 8812',
      payee_id: null,
      reference: null,
      created_at: '2026-10-22T15:45:00.000Z',
    });
  });

  it(`shows at most ${STATEMENT_LINES} lines`, async () => {
    const sub = await seedCustomer();
    const db = testEnv().DB;
    await db.batch(
      Array.from({ length: 25 }, (_, i) =>
        db
          .prepare(
            `INSERT INTO transactions (tenant_id, id, customer_ref, account_id, kind, category, amount_minor, currency,
               description, created_at)
             SELECT tenant_id, ?, customer_ref, id, 'debit', 'card', 100, currency, 'Coffee', ? FROM accounts
             WHERE customer_ref = ?`,
          )
          .bind(
            `txn_extra_${sub}_${i}`,
            `2026-10-26T0${Math.floor(i / 10)}:${String(i % 10).padStart(2, '0')}:00.000Z`,
            sub,
          ),
      ),
    );
    const body = CORE_RESPONSES['statement.view'].parse((await read(sub, 'statement.view')).res.body);
    expect(body.transactions).toHaveLength(STATEMENT_LINES);
    expect(body.transactions.every((t) => t.description === 'Coffee')).toBe(true);
  });

  it('the US twin’s checking statement is in USD; a savings statement does not exist for it', async () => {
    const sub = await seedCustomer('US');
    const body = CORE_RESPONSES['statement.view'].parse(
      (await read(sub, 'statement.view', 'checking')).res.body,
    );
    expect(body.transactions).toHaveLength(4);
    expect(body.transactions.every((t) => t.amount.currency === 'USD')).toBe(true);
    expect((await read(sub, 'statement.view')).res.status).toBe(404);
  });

  it('never shows another customer’s lines', async () => {
    const [mine, theirs] = [await seedCustomer(), await seedCustomer()];
    const body = CORE_RESPONSES['statement.view'].parse((await read(mine, 'statement.view')).res.body);
    expect(body.transactions.some((t) => t.id.includes(theirs.slice(4)))).toBe(false);
  });
});
