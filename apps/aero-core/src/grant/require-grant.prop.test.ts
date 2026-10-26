import { canonicalJson, HalynError, JwksSchema } from '@halyn/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TENANT, testEnv } from '../../test/fixtures/env';
import { mintGrant } from '../../test/fixtures/grants';
import { requireGrant } from './require-grant';

// Invariant 1: a grant executes exactly the params it was signed for. Any other params — however close — are refused,
// and the same params in any key order are accepted (the hash is over canonical JSON).

const options = { seed: 20261027, numRuns: 60 };
const NOW_S = Math.floor(Date.UTC(2026, 9, 27, 4, 30, 0) / 1000);
const TRANSFERS = ['transfer.new_payee', 'transfer.saved', 'wire.new'] as const;

const savedTransfer = fc.record({
  amount_minor: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  currency: fc.constantFrom('INR', 'USD'),
  payee_id: fc.constantFrom('payee_mom', 'payee_landlord', 'payee_us_landlord'),
});

function reversedKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).reverse());
}

async function verify(token: string, params: unknown) {
  try {
    return await requireGrant({
      token,
      params: () => Promise.resolve(params),
      actions: TRANSFERS,
      jwks: JwksSchema.parse(JSON.parse(testEnv().HALYN_PUBLIC_JWKS)),
      tenant: TENANT,
      nowMs: NOW_S * 1000,
    });
  } catch (err) {
    if (err instanceof HalynError) return err.code;
    throw err;
  }
}

describe('grant ↔ params binding (property)', () => {
  it('accepts the signed params in any key order, and refuses every other params', async () => {
    await fc.assert(
      fc.asyncProperty(savedTransfer, savedTransfer, async (signed, presented) => {
        const { token } = await mintGrant({
          action: 'transfer.saved',
          params: signed,
          sub: 'cus_saksham',
          iat: NOW_S,
        });
        const same = await verify(token, reversedKeys(signed));
        expect(typeof same === 'object' && same.proposed.params).toEqual(signed);
        const other = await verify(token, presented);
        if (canonicalJson(presented) === canonicalJson(signed)) expect(typeof other).toBe('object');
        else expect(other).toBe('E_PARAMS_MISMATCH');
      }),
      options,
    );
  });

  it('refuses any single changed or added field', async () => {
    await fc.assert(
      fc.asyncProperty(
        savedTransfer,
        fc.constantFrom('amount_minor', 'currency', 'payee_id', 'note'),
        async (signed, field) => {
          const { token } = await mintGrant({
            action: 'transfer.saved',
            params: signed,
            sub: 'cus_saksham',
            iat: NOW_S,
          });
          const tampered: Record<string, unknown> = { ...signed };
          tampered[field] =
            field === 'amount_minor'
              ? signed.amount_minor - 1 || 2
              : field === 'currency'
                ? signed.currency === 'INR'
                  ? 'USD'
                  : 'INR'
                : 'payee_x';
          expect(await verify(token, tampered)).toBe('E_PARAMS_MISMATCH');
        },
      ),
      options,
    );
  });
});
