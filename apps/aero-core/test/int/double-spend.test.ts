import type { CoreActionId } from '@halyn/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer } from '../fixtures/env';
import { mintGrant } from '../fixtures/grants';
import { coreRequest } from '../fixtures/http';

// Invariant 1, concurrently: N requests carrying ONE grant hit the real Worker at once. The jti insert and the write are
// one D1 batch, so exactly one request executes; every other one is 401 E_GRANT_REUSED (naming the winner's reference)
// and writes nothing. And with DIFFERENT grants racing for one balance, the balance never goes negative.

const N = 12;

interface Body {
  reference?: string;
  error?: { code: string; details?: { outcome?: string; reference?: string } };
}

async function race(action: CoreActionId, params: Record<string, unknown>, sub: string) {
  const grant = await mintGrant({ action, params, sub });
  const responses = await Promise.all(
    Array.from({ length: N }, () => exports.default.fetch(coreRequest(action, params, grant.token))),
  );
  const bodies = await Promise.all(responses.map((r) => r.json() as Promise<Body>));
  return { grant, statuses: responses.map((r) => r.status), bodies };
}

function expectOneWinner({ grant, statuses, bodies }: Awaited<ReturnType<typeof race>>, write = true) {
  expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  expect(statuses.filter((s) => s === 401)).toHaveLength(N - 1);
  const reference = `AERO-${grant.jti.slice(-6)}`;
  // A write's 200 carries the reference; a read's does not.
  if (write) expect(bodies.find((b) => !b.error)?.reference).toBe(reference);
  const reused = bodies.filter((b) => b.error?.code === 'E_GRANT_REUSED');
  expect(reused).toHaveLength(N - 1);
  // Every loser points at the one execution.
  for (const b of reused) expect(b.error?.details).toMatchObject({ outcome: 'executed', reference });
}

describe(`concurrent double-spend: ${N} requests, one grant`, () => {
  it('transfer.saved: exactly one debit, one transaction, one used_grants row', async () => {
    const sub = await seedCustomer();
    const params = { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' };
    const result = await race('transfer.saved', params, sub);
    const { grant } = result;
    expectOneWinner(result);
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
    const result = await race('transfer.new_payee', params, sub);
    const { grant } = result;
    expectOneWinner(result);
    expect(await rows('SELECT id FROM payees WHERE added_by_grant = ?', grant.jti)).toHaveLength(1);
    expect(await rows('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub)).toEqual([
      { balance_minor: 52_000_000 - 4500000 },
    ]);
  });

  it('fee.waive: credited exactly once', async () => {
    const sub = await seedCustomer();
    const params = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
    expectOneWinner(await race('fee.waive', params, sub));
    expect(await rows('SELECT balance_minor FROM accounts WHERE customer_ref = ?', sub)).toEqual([
      { balance_minor: 52_000_000 + 60000 },
    ]);
  });

  it('statement.view: a read grant is read once', async () => {
    const sub = await seedCustomer();
    expectOneWinner(await race('statement.view', { account: 'savings' }, sub), false);
  });

  it('DIFFERENT grants whose sum exceeds the balance, at once: never below zero, losers write nothing', async () => {
    const sub = await seedCustomer();
    const OPENING = 52_000_000;
    const AMOUNT = 10_000_000; // 8 × ₹1,00,000 asked of ₹5,20,000: at most 5 fit
    const params = { amount_minor: AMOUNT, currency: 'INR', payee_id: 'payee_landlord' };
    const grants = await Promise.all(
      Array.from({ length: 8 }, () => mintGrant({ action: 'transfer.saved', params, sub })),
    );
    const responses = await Promise.all(
      grants.map((g) => exports.default.fetch(coreRequest('transfer.saved', params, g.token))),
    );
    const statuses = responses.map((r) => r.status);
    const winners = grants.filter((_, i) => statuses[i] === 200);
    const losers = grants.filter((_, i) => statuses[i] !== 200);
    // Each loser was refused up front (400, balance too low) or by the batch's precondition (500): never a 401.
    expect(statuses.every((s) => s === 200 || s === 400 || s === 500)).toBe(true);
    // A loser loses only to a lower balance, which only ever falls: exactly floor(opening / amount) win.
    expect(winners).toHaveLength(Math.floor(OPENING / AMOUNT));
    const [account] = await rows<{ balance_minor: number }>(
      'SELECT balance_minor FROM accounts WHERE customer_ref = ?',
      sub,
    );
    expect(account?.balance_minor).toBe(OPENING - winners.length * AMOUNT);
    expect(account?.balance_minor).toBeGreaterThanOrEqual(0);
    const debited = await rows<{ grant_jti: string }>(
      "SELECT grant_jti FROM transactions WHERE customer_ref = ? AND kind = 'debit' AND grant_jti IS NOT NULL",
      sub,
    );
    expect(debited.map((t) => t.grant_jti).sort()).toEqual(winners.map((g) => g.jti).sort());
    for (const g of winners)
      expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', g.jti), g.jti).toHaveLength(1);
    for (const g of losers)
      expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', g.jti), g.jti).toEqual([]);
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
