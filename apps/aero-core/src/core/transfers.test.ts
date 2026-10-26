import { type ActionId, CORE_RESPONSES } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, testEnv } from '../../test/fixtures/env';
import { mintGrant } from '../../test/fixtures/grants';
import { coreRequest, reply, testApp } from '../../test/fixtures/http';
import { SEED_FACTS } from '../seed';

const NOW_MS = Date.UTC(2026, 9, 27, 4, 30, 0);
const NOW_S = NOW_MS / 1000;
const send = testApp(NOW_MS);
const IN_BALANCE = SEED_FACTS.IN.balance_minor;

const SAVED = { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' };
const NEW_PAYEE = {
  amount_minor: 4500000,
  currency: 'INR',
  payee_account_last4: '4471',
  payee_ifsc: 'AERO0000001',
};
const WIRE = { amount_minor: 800000, currency: 'USD', payee_account_last4: '3310', routing_last4: '0021' };

async function pay(
  sub: string,
  action: 'transfer.saved' | 'transfer.new_payee' | 'wire.new',
  params: Record<string, unknown>,
) {
  const grant = await mintGrant({ action: action as ActionId, params, sub, iat: NOW_S });
  return { grant, res: await reply(send(coreRequest(action, params, grant.token))) };
}

const balance = async (sub: string) =>
  (await rows<{ balance_minor: number }>('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub))[0]
    ?.balance_minor;
const grantTxns = (sub: string) =>
  rows(
    'SELECT kind, category, amount_minor, currency, payee_id, grant_jti FROM transactions WHERE customer_ref = ? AND grant_jti IS NOT NULL',
    sub,
  );

describe('POST /core/transfers', () => {
  it('transfer.saved: debits the primary account and records the transaction (scenarios 8, 12)', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await pay(sub, 'transfer.saved', SAVED);
    expect(res.status).toBe(200);
    const body = CORE_RESPONSES['transfer.saved'].parse(res.body);
    expect(body).toMatchObject({
      action: 'transfer.saved',
      reference: `AERO-${grant.jti.slice(-6)}`,
      transaction: {
        kind: 'debit',
        category: 'transfer',
        amount: { amount_minor: 490000, currency: 'INR' },
        description: 'Transfer to Landlord',
        payee_id: 'payee_landlord',
        created_at: new Date(NOW_MS).toISOString(),
      },
      balance: { amount_minor: IN_BALANCE - 490000, currency: 'INR' },
    });
    expect(await balance(sub)).toBe(IN_BALANCE - 490000);
    expect(await grantTxns(sub)).toEqual([
      {
        kind: 'debit',
        category: 'transfer',
        amount_minor: 490000,
        currency: 'INR',
        payee_id: 'payee_landlord',
        grant_jti: grant.jti,
      },
    ]);
  });

  it('transfer.new_payee: adds an unsaved payee, then pays it (scenarios 3, 6, 11 if approved)', async () => {
    const sub = await seedCustomer();
    const { res } = await pay(sub, 'transfer.new_payee', { ...NEW_PAYEE, payee_name: 'Asha' });
    expect(res.status).toBe(200);
    const body = CORE_RESPONSES['transfer.new_payee'].parse(res.body);
    expect(body.transaction.description).toBe('Transfer to Asha, account ending 4471');
    expect(
      await rows(
        'SELECT name, account_last4, ifsc, routing_last4, saved FROM payees WHERE customer_ref = ? AND id = ?',
        sub,
        body.transaction.payee_id,
      ),
    ).toEqual([{ name: 'Asha', account_last4: '4471', ifsc: 'AERO0000001', routing_last4: null, saved: 0 }]);
    expect(await balance(sub)).toBe(IN_BALANCE - 4500000);
  });

  it('a new payee is not a saved payee: paying it with transfer.saved → 404', async () => {
    const sub = await seedCustomer();
    const first = CORE_RESPONSES['transfer.new_payee'].parse(
      (await pay(sub, 'transfer.new_payee', NEW_PAYEE)).res.body,
    );
    expect(first.transaction.description).toBe('Transfer to new payee, account ending 4471');
    const { res } = await pay(sub, 'transfer.saved', { ...SAVED, payee_id: first.transaction.payee_id });
    expect(res.status).toBe(404);
  });

  it('wire.new (US): adds a payee by routing last 4 and records a wire (scenario 10 if approved)', async () => {
    const sub = await seedCustomer('US');
    const { res } = await pay(sub, 'wire.new', WIRE);
    expect(res.status).toBe(200);
    const body = CORE_RESPONSES['wire.new'].parse(res.body);
    expect(body.transaction).toMatchObject({ category: 'wire', description: 'Wire to account ending 3310' });
    expect(body.balance).toEqual({ amount_minor: SEED_FACTS.US.balance_minor - 800000, currency: 'USD' });
    expect(
      await rows(
        'SELECT ifsc, routing_last4, saved FROM payees WHERE customer_ref = ? AND id = ?',
        sub,
        body.transaction.payee_id,
      ),
    ).toEqual([{ ifsc: null, routing_last4: '0021', saved: 0 }]);
  });

  it('never overdraws: more than the balance → 400, nothing changes', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await pay(sub, 'transfer.saved', { ...SAVED, amount_minor: IN_BALANCE + 1 });
    expect(res).toEqual({
      status: 400,
      body: { error: { code: 'E_BAD_REQUEST', message: 'The balance is too low for this transfer' } },
    });
    expect(await balance(sub)).toBe(IN_BALANCE);
    expect(await grantTxns(sub)).toEqual([]);
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', grant.jti)).toEqual([]);
  });

  it('the exact balance can be sent (to zero)', async () => {
    const sub = await seedCustomer();
    expect((await pay(sub, 'transfer.saved', { ...SAVED, amount_minor: IN_BALANCE })).res.status).toBe(200);
    expect(await balance(sub)).toBe(0);
  });

  it.each([
    ['an unknown saved payee', 'IN', 'transfer.saved', { ...SAVED, payee_id: 'payee_nope' }],
    ['no account in that currency', 'US', 'transfer.saved', { ...SAVED, currency: 'INR' }],
  ] as const)('%s → 404', async (_, region, action, params) => {
    const sub = await seedCustomer(region);
    expect((await pay(sub, action, params)).res.status).toBe(404);
  });

  it('a blocked account cannot pay → 400', async () => {
    const sub = await seedCustomer();
    await testEnv()
      .DB.prepare("UPDATE accounts SET status = 'blocked' WHERE customer_ref = ?")
      .bind(sub)
      .run();
    const { res } = await pay(sub, 'transfer.saved', SAVED);
    expect(res).toEqual({
      status: 400,
      body: { error: { code: 'E_BAD_REQUEST', message: 'This account cannot make payments' } },
    });
  });
});
