import type { CoreActionId } from '@halyn/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer } from '../fixtures/env';
import { mintGrant } from '../fixtures/grants';
import { coreRequest } from '../fixtures/http';

// Invariant 1, concurrently: N requests carrying ONE grant hit the real Worker at once. The jti insert and the write are
// one D1 batch, so exactly one request executes; every other one is 401 E_GRANT_REUSED and writes nothing.

const N = 12;

async function race(action: CoreActionId, params: Record<string, unknown>, sub: string) {
  const grant = await mintGrant({ action, params, sub });
  const responses = await Promise.all(
    Array.from({ length: N }, () => exports.default.fetch(coreRequest(action, params, grant.token))),
  );
  const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ error?: { code: string } }>));
  return { grant, statuses: responses.map((r) => r.status), bodies };
}

function expectOneWinner(statuses: number[], bodies: { error?: { code: string } }[]) {
  expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  expect(statuses.filter((s) => s === 401)).toHaveLength(N - 1);
  expect(bodies.filter((b) => b.error?.code === 'E_GRANT_REUSED')).toHaveLength(N - 1);
}

describe(`concurrent double-spend: ${N} requests, one grant`, () => {
  it('transfer.saved: exactly one debit, one transaction, one used_grants row', async () => {
    const sub = await seedCustomer();
    const params = { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' };
    const { grant, statuses, bodies } = await race('transfer.saved', params, sub);
    expectOneWinner(statuses, bodies);
    expect(await rows('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub)).toEqual([
      { balance_minor: 52_000_000 - 490000 },
    ]);
    expect(await rows('SELECT amount_minor FROM transactions WHERE grant_jti = ?', grant.jti)).toEqual([
      { amount_minor: 490000 },
    ]);
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', grant.jti)).toHaveLength(1);
  });

  it('transfer.new_payee: exactly one new payee and one debit', async () => {
    const sub = await seedCustomer();
    const params = {
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
    };
    const { grant, statuses, bodies } = await race('transfer.new_payee', params, sub);
    expectOneWinner(statuses, bodies);
    expect(await rows('SELECT id FROM payees WHERE added_by_grant = ?', grant.jti)).toHaveLength(1);
    expect(await rows('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub)).toEqual([
      { balance_minor: 52_000_000 - 4500000 },
    ]);
  });

  it('fee.waive: credited exactly once', async () => {
    const sub = await seedCustomer();
    const params = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
    const { statuses, bodies } = await race('fee.waive', params, sub);
    expectOneWinner(statuses, bodies);
    expect(await rows('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub)).toEqual([
      { balance_minor: 52_000_000 + 60000 },
    ]);
  });

  it('statement.view: a read grant is read once', async () => {
    const sub = await seedCustomer();
    const { statuses, bodies } = await race('statement.view', { account: 'savings' }, sub);
    expectOneWinner(statuses, bodies);
  });

  it('two DIFFERENT grants racing to waive one fee: one credit at most', async () => {
    const sub = await seedCustomer();
    const params = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
    const grants = await Promise.all(
      Array.from({ length: 6 }, () => mintGrant({ action: 'fee.waive', params, sub })),
    );
    const statuses = (
      await Promise.all(grants.map((g) => exports.default.fetch(coreRequest('fee.waive', params, g.token))))
    ).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 400 || s === 500)).toBe(true);
    expect(
      await rows(
        "SELECT COUNT(*) AS n FROM transactions WHERE customer_ref = ? AND category = 'fee_waiver'",
        sub,
      ),
    ).toEqual([{ n: 1 }]);
    expect(await rows('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub)).toEqual([
      { balance_minor: 52_000_000 + 60000 },
    ]);
  });
});
