import { HalynError, JwksSchema, type ReasonCode } from '@halyn/shared';
import { describe, expect, it, vi } from 'vitest';
import { TENANT, testEnv } from '../../test/fixtures/env';
import { mintGrant, strangerSigner } from '../../test/fixtures/grants';
import { type GrantCheck, requireGrant } from './require-grant';

// The check in front of every Aero Core route (invariant 1). Single use is checked later, in the D1 batch.

const NOW_S = Math.floor(Date.UTC(2026, 9, 27, 4, 30, 0) / 1000);
const NOW_MS = NOW_S * 1000 + 250;
const SUB = 'cus_saksham';
const FREEZE = { card_last4: '8812' };
const TRANSFERS = ['transfer.new_payee', 'transfer.saved', 'wire.new'] as const;
const SAVED = { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' };

const jwks = () => JwksSchema.parse(JSON.parse(testEnv().HALYN_PUBLIC_JWKS));

function check(token: string | undefined, overrides: Partial<GrantCheck> = {}): GrantCheck {
  return {
    token,
    params: () => Promise.resolve(FREEZE),
    actions: ['card.freeze'],
    jwks: jwks(),
    tenant: TENANT,
    nowMs: NOW_MS,
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<ReasonCode | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    if (err instanceof HalynError) return err.code;
    throw err;
  }
}

const freezeGrant = (overrides: Parameters<typeof mintGrant>[0]['overrides'] = {}) =>
  mintGrant({ action: 'card.freeze', params: FREEZE, sub: SUB, iat: NOW_S, overrides });

describe('requireGrant', () => {
  it('returns the jti, the claims and the typed proposal for a valid grant', async () => {
    const { token, jti } = await freezeGrant();
    const verified = await requireGrant(check(token));
    expect(verified.jti).toBe(jti);
    expect(verified.claims).toMatchObject({ sub: SUB, tenant: TENANT, action: 'card.freeze' });
    expect(verified.proposed).toEqual({ action: 'card.freeze', params: FREEZE });
  });

  it.each([undefined, '', '   '])(
    'no grant (%j) → E_GRANT_MISSING, before reading any params',
    async (token) => {
      const params = vi.fn(() => Promise.resolve(FREEZE));
      expect(await codeOf(requireGrant(check(token, { params })))).toBe('E_GRANT_MISSING');
      expect(params).not.toHaveBeenCalled();
    },
  );

  it('a route serving several actions takes the one the signed grant names', async () => {
    const { token } = await mintGrant({ action: 'transfer.saved', params: SAVED, sub: SUB, iat: NOW_S });
    const verified = await requireGrant(
      check(token, { actions: TRANSFERS, params: () => Promise.resolve(SAVED) }),
    );
    expect(verified.proposed).toEqual({ action: 'transfer.saved', params: SAVED });
  });

  it.each([
    ['a grant for an action this route does not perform', { actions: TRANSFERS }],
    ['a grant for another tenant (expectedTenant)', { tenant: 'ten_other' }],
  ])('%s → E_GRANT_INVALID', async (_, overrides) => {
    const { token } = await freezeGrant();
    expect(await codeOf(requireGrant(check(token, overrides)))).toBe('E_GRANT_INVALID');
  });

  it.each([
    ['a tampered payload', async () => (await freezeGrant()).token.replace(/\.([^.]+)\./, '.eyJ4IjoxfQ.')],
    [
      'a key Aero Core does not trust',
      async () =>
        (
          await mintGrant({
            action: 'card.freeze',
            params: FREEZE,
            sub: SUB,
            iat: NOW_S,
            signer: await strangerSigner(),
          })
        ).token,
    ],
    ['the wrong issuer', async () => (await freezeGrant({ iss: 'mallory' })).token],
    ['the wrong audience', async () => (await freezeGrant({ aud: 'halyn-api' })).token],
    ['a garbage token', () => Promise.resolve('not.a.grant')],
  ])('%s → E_GRANT_INVALID', async (_, token) => {
    expect(await codeOf(requireGrant(check(await token())))).toBe('E_GRANT_INVALID');
  });

  it('expired exactly at exp (no leeway) → E_GRANT_EXPIRED', async () => {
    const { token } = await freezeGrant();
    expect(await codeOf(requireGrant(check(token, { nowMs: (NOW_S + 60) * 1000 - 1 })))).toBe('ok');
    expect(await codeOf(requireGrant(check(token, { nowMs: (NOW_S + 60) * 1000 })))).toBe('E_GRANT_EXPIRED');
  });

  it.each([
    ['other params', { card_last4: '8813' }],
    ['an extra key', { card_last4: '8812', note: 'x' }],
    ['an unreadable body', undefined],
  ])('%s → E_PARAMS_MISMATCH', async (_, params) => {
    const { token } = await freezeGrant();
    expect(await codeOf(requireGrant(check(token, { params: () => Promise.resolve(params) })))).toBe(
      'E_PARAMS_MISMATCH',
    );
  });

  it('a validly signed grant over params that fail the action schema → E_BAD_REQUEST (nothing executes)', async () => {
    const bad = { card_last4: '88' };
    const { token } = await mintGrant({ action: 'card.freeze', params: bad, sub: SUB, iat: NOW_S });
    expect(await codeOf(requireGrant(check(token, { params: () => Promise.resolve(bad) })))).toBe(
      'E_BAD_REQUEST',
    );
  });
});
