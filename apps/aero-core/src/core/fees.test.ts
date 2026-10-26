import { CORE_RESPONSES } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, testEnv } from '../../test/fixtures/env';
import { mintGrant } from '../../test/fixtures/grants';
import { coreRequest, reply, testApp } from '../../test/fixtures/http';
import { SEED_FACTS } from '../seed';

const NOW_MS = Date.UTC(2026, 9, 27, 4, 30, 0);
const NOW_S = NOW_MS / 1000;
const send = testApp(NOW_MS);
const FEE = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };

async function waive(sub: string, params: Record<string, unknown> = FEE) {
  const grant = await mintGrant({ action: 'fee.waive', params, sub, iat: NOW_S });
  return { grant, res: await reply(send(coreRequest('fee.waive', params, grant.token))) };
}

const balance = async (sub: string) =>
  (await rows<{ balance_minor: number }>('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub))[0]
    ?.balance_minor;

describe('POST /core/fees/waive (fee.waive, scenario 2)', () => {
  it('credits the fee back, marks it waived and records a fee_waiver transaction', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await waive(sub);
    expect(res.status).toBe(200);
    expect(CORE_RESPONSES['fee.waive'].parse(res.body)).toEqual({
      action: 'fee.waive',
      reference: `AERO-${grant.jti.slice(-6)}`,
      fee: { id: 'fee_late_oct', status: 'waived', amount: { amount_minor: 60000, currency: 'INR' } },
      balance: { amount_minor: SEED_FACTS.IN.balance_minor + 60000, currency: 'INR' },
    });
    expect(await balance(sub)).toBe(SEED_FACTS.IN.balance_minor + 60000);
    expect(await rows('SELECT status, waived_by_grant FROM fees WHERE customer_ref = ?', sub)).toEqual([
      { status: 'waived', waived_by_grant: grant.jti },
    ]);
    expect(
      await rows(
        "SELECT kind, amount_minor, currency, fee_id, grant_jti FROM transactions WHERE customer_ref = ? AND category = 'fee_waiver'",
        sub,
      ),
    ).toEqual([
      { kind: 'credit', amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct', grant_jti: grant.jti },
    ]);
  });

  it('a fee is waived once: a second, different grant → 400 and no second credit', async () => {
    const sub = await seedCustomer();
    await waive(sub);
    const { res } = await waive(sub);
    expect(res).toEqual({
      status: 400,
      body: { error: { code: 'E_BAD_REQUEST', message: 'This fee has already been waived' } },
    });
    expect(await balance(sub)).toBe(SEED_FACTS.IN.balance_minor + 60000);
  });

  it.each([
    ['another amount', { ...FEE, amount_minor: 50000 }],
    ['another currency', { ...FEE, currency: 'USD' }],
  ])('%s than the fee → 400 E_BAD_REQUEST, nothing changes', async (_, params) => {
    const sub = await seedCustomer();
    const { grant, res } = await waive(sub, params);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'E_BAD_REQUEST', message: 'The amount does not match the fee' },
    });
    expect(await balance(sub)).toBe(SEED_FACTS.IN.balance_minor);
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', grant.jti)).toEqual([]);
  });

  it('an unknown fee → 404', async () => {
    const sub = await seedCustomer();
    expect((await waive(sub, { ...FEE, fee_id: 'fee_nope' })).res.status).toBe(404);
  });

  it('a racing second waiver is rolled back by the unique fee_waiver index (500, nothing changes)', async () => {
    const sub = await seedCustomer();
    // Another waiver for the same fee already committed between this request's read and its write.
    await testEnv()
      .DB.prepare(
        `INSERT INTO transactions (tenant_id, id, customer_ref, account_id, kind, category, amount_minor, currency,
           description, fee_id, created_at)
         SELECT tenant_id, 'txn_race', customer_ref, account_id, 'credit', 'fee_waiver', amount_minor, currency, 'race',
           id, '2026-10-27T04:00:00.000Z' FROM fees WHERE customer_ref = ?`,
      )
      .bind(sub)
      .run();
    const { grant, res } = await waive(sub);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'E_FAIL_CLOSED', message: 'The request failed closed; nothing was changed.' },
    });
    expect(await balance(sub)).toBe(SEED_FACTS.IN.balance_minor);
    expect(await rows('SELECT status FROM fees WHERE customer_ref = ?', sub)).toEqual([{ status: 'due' }]);
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', grant.jti)).toEqual([]);
  });

  it('the US twin waives its $35 fee in USD', async () => {
    const sub = await seedCustomer('US');
    const { res } = await waive(sub, { amount_minor: 3500, currency: 'USD', fee_id: 'fee_us_late_oct' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      balance: { amount_minor: SEED_FACTS.US.balance_minor + 3500, currency: 'USD' },
    });
  });
});
