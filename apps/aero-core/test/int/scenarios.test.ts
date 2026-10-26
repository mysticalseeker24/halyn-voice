import { CORE_RESPONSES, type CoreActionId, type CoreResponse } from '@halyn/shared';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_CUSTOMERS, seedStatements } from '../../src/seed';
import { testEnv } from '../fixtures/env';
import { mintGrant } from '../fixtures/grants';
import { coreRequest, reply } from '../fixtures/http';

// The demo seed (seed/seed.sql) makes every Aero Core step of tests/scenarios/scenarios.yaml executable with the
// exact params the scenarios send. Step 7's text-mode runner calls these routes after the Gate allows (or the customer
// approves); here each call carries a grant directly. The only file that uses the demo customers' ids.

const IN = 'cus_saksham';
const US = 'cus_saksham_us';

async function run<A extends CoreActionId>(
  action: A,
  params: Record<string, unknown>,
  sub = IN,
): Promise<CoreResponse<A>> {
  const { token } = await mintGrant({ action, params, sub });
  const res = await reply(exports.default.fetch(coreRequest(action, params, token)));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return CORE_RESPONSES[action].parse(res.body) as CoreResponse<A>;
}

beforeAll(async () => {
  const db = testEnv().DB;
  await db.batch(seedStatements(DEMO_CUSTOMERS).map((sql) => db.prepare(sql)));
});

describe('scenario steps against the demo seed', () => {
  it('1: freeze card 8812', async () => {
    expect(await run('card.freeze', { card_last4: '8812' })).toMatchObject({ card: { status: 'frozen' } });
  });

  it('2: waive the ₹600 late fee', async () => {
    const body = await run('fee.waive', { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' });
    expect(body.balance).toEqual({ amount_minor: 52_000_000 + 60000, currency: 'INR' });
  });

  it('5: the savings statement, then move EMI loan_personal_1 to the 10th', async () => {
    const statement = await run('statement.view', { account: 'savings' });
    expect(statement.transactions.length).toBeGreaterThan(0);
    expect(await run('emi.move_date', { loan_id: 'loan_personal_1', new_day: 10 })).toMatchObject({
      loan: { emi_day: 10, previous_emi_day: 5 },
    });
  });

  it('7 and 8: the params a balance view and a ₹10,000 saved transfer would execute', async () => {
    expect(await run('balance.view', { account: 'savings' })).toMatchObject({ balance: { currency: 'INR' } });
    expect(
      await run('transfer.saved', { amount_minor: 1000000, currency: 'INR', payee_id: 'payee_mom' }),
    ).toMatchObject({
      transaction: { payee_id: 'payee_mom' },
    });
  });

  it('12: ₹4,900 transfers to the landlord execute (the Gate decides how many)', async () => {
    for (let i = 0; i < 2; i += 1)
      await run('transfer.saved', { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' });
  });

  it('3, 6, 11 (if approved): ₹45,000 to a new payee ending 4471', async () => {
    const params = {
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
    };
    expect(await run('transfer.new_payee', params)).toMatchObject({ transaction: { category: 'transfer' } });
  });

  it('10 (if a specialist releases it): the US twin’s $8,000 wire', async () => {
    const params = {
      amount_minor: 800000,
      currency: 'USD',
      payee_account_last4: '3310',
      routing_last4: '0021',
    };
    expect(await run('wire.new', params, US)).toMatchObject({
      balance: { amount_minor: 1_245_000 - 800000, currency: 'USD' },
    });
  });

  it('11: a direct POST /core/transfers without a grant → 401 E_GRANT_MISSING', async () => {
    const params = {
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
    };
    expect(await reply(exports.default.fetch(coreRequest('transfer.new_payee', params)))).toMatchObject({
      status: 401,
      body: { error: { code: 'E_GRANT_MISSING' } },
    });
  });

  it('re-seeding resets the demo state', async () => {
    const db = testEnv().DB;
    await db.batch(seedStatements(DEMO_CUSTOMERS).map((sql) => db.prepare(sql)));
    expect(await run('balance.view', { account: 'savings' })).toMatchObject({
      balance: { amount_minor: 52_000_000, currency: 'INR' },
    });
    expect(await run('card.freeze', { card_last4: '8812' })).toMatchObject({ already_frozen: false });
  });
});
