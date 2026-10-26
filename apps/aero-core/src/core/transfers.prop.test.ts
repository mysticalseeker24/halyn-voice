import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, testEnv } from '../../test/fixtures/env';
import { mintGrant } from '../../test/fixtures/grants';
import { coreRequest, testApp } from '../../test/fixtures/http';

// Invariants 1 and 9 against the real D1: for any sequence of transfers (each with its own grant, each grant then
// replayed), every grant executes at most once, the balance never goes negative, and it always equals the opening
// balance minus exactly the transfers that succeeded — integer minor units, no drift.

const options = { seed: 20261027, numRuns: 12 };
const NOW_MS = Date.UTC(2026, 9, 27, 4, 30, 0);
const NOW_S = NOW_MS / 1000;
const send = testApp(NOW_MS, 7);
const OPENING = 1_000_000; // ₹10,000

describe('transfers (property, real D1)', () => {
  it('single use, no overdraft, exact conservation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 400_000 }), { minLength: 1, maxLength: 8 }),
        async (amounts) => {
          const sub = await seedCustomer();
          await testEnv()
            .DB.prepare('UPDATE accounts SET balance_minor = ? WHERE customer_ref = ?')
            .bind(OPENING, sub)
            .run();
          let expected = OPENING;
          for (const amount_minor of amounts) {
            const params = { amount_minor, currency: 'INR', payee_id: 'payee_mom' };
            const { token } = await mintGrant({ action: 'transfer.saved', params, sub, iat: NOW_S });
            const first = await send(coreRequest('transfer.saved', params, token));
            if (amount_minor <= expected) {
              expect(first.status).toBe(200);
              expected -= amount_minor;
            } else expect(first.status).toBe(400);
            const replay = await send(coreRequest('transfer.saved', params, token));
            expect(replay.status).toBe(first.status === 200 ? 401 : 400);
          }
          const [account] = await rows<{ balance_minor: number }>(
            'SELECT balance_minor FROM accounts WHERE customer_ref = ?',
            sub,
          );
          expect(account?.balance_minor).toBe(expected);
          expect(expected).toBeGreaterThanOrEqual(0);
          const [debited] = await rows<{ total: number | null }>(
            "SELECT SUM(amount_minor) AS total FROM transactions WHERE customer_ref = ? AND grant_jti IS NOT NULL AND kind = 'debit'",
            sub,
          );
          expect(OPENING - (debited?.total ?? 0)).toBe(expected);
        },
      ),
      options,
    );
  });
});
