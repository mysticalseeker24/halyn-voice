import { HalynError, PassClaimsSchema, PassIdSchema, type PassScope } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../test/fixtures/crypto';
import { IN_PACK, inPackWith, US_PACK } from '../../test/fixtures/gate';
import { ASSISTANT_NUMBER, CLOCK, NOW, SEED_SCOPES } from '../../test/fixtures/pass';
import { issuePass, passRow, PassRowSchema, signPass } from './index';
import { testKeys } from '../../test/fixtures/crypto';

const INPUT = {
  tenant: 'ten_aero',
  customer_id: 'cus_saksham',
  assistant: { name: "Saksham's Assistant", numbers: [ASSISTANT_NUMBER] },
  scopes: SEED_SCOPES,
  expires_in_days: 7,
  customer_passkey_sig: 'c2lnbmF0dXJl',
};

describe('issuePass', () => {
  it('issues halyn-pass/0.1 claims for Pass-eligible scopes', () => {
    const result = issuePass(INPUT, IN_PACK, CLOCK, seededRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(PassClaimsSchema.parse(result.claims)).toEqual(result.claims);
    expect(PassIdSchema.safeParse(result.claims.pid).success).toBe(true);
    expect(result.claims).toMatchObject({
      v: 'halyn-pass/0.1',
      tenant: 'ten_aero',
      sub: 'cus_saksham',
      scopes: SEED_SCOPES,
      iat: NOW / 1000,
      exp: NOW / 1000 + 7 * 86_400,
      cnf: { customer_passkey_sig: 'c2lnbmF0dXJl' },
    });
  });

  it('allows the 30-day maximum', () => {
    const result = issuePass({ ...INPUT, expires_in_days: 30 }, IN_PACK, CLOCK, seededRng(1));
    expect(result.ok && result.claims.exp - result.claims.iat).toBe(30 * 86_400);
  });

  it.each<[string, PassScope[], typeof IN_PACK, string[]]>([
    ['a critical action (invariant 5)', [{ action: 'transfer.new_payee' }], IN_PACK, ['transfer.new_payee']],
    [
      'a non-eligible action',
      [{ action: 'card.freeze' }, { action: 'transfer.saved' }],
      IN_PACK,
      ['transfer.saved'],
    ],
    ['an action the region does not offer', [{ action: 'emi.move_date' }], US_PACK, ['emi.move_date']],
    [
      'an action the pack has made ineligible',
      [{ action: 'card.freeze' }],
      inPackWith(
        (p) => void (p.actions['card.freeze'] = { tier: 0, protective: true, pass_eligible: false }),
      ),
      ['card.freeze'],
    ],
    [
      'several at once',
      [{ action: 'wire.new' }, { action: 'account.close' }],
      IN_PACK,
      ['wire.new', 'account.close'],
    ],
  ])('rejects %s with X_PASS_INVALID', (_, scopes, pack, rejected) => {
    const result = issuePass({ ...INPUT, scopes }, pack, CLOCK, seededRng(1));
    expect(result).toMatchObject({ ok: false, code: 'X_PASS_INVALID', rejected });
  });

  it.each([
    ['0 days', { expires_in_days: 0 }],
    ['31 days', { expires_in_days: 31 }],
    ['no scopes', { scopes: [] }],
    ['a duplicate scope', { scopes: [{ action: 'card.freeze' }, { action: 'card.freeze' }] }],
    ['a calling number that is not E.164', { assistant: { name: 'A', numbers: ['8065356379'] } }],
    ['a bad passkey signature', { customer_passkey_sig: 'not base64url!' }],
    ['a bad customer id', { customer_id: 'saksham' }],
  ])('rejects %s as invalid input', (_, patch) => {
    const result = issuePass({ ...INPUT, ...patch } as never, IN_PACK, CLOCK, seededRng(1));
    expect(result).toMatchObject({ ok: false, code: 'X_PASS_INVALID', rejected: [] });
  });
});

describe('passRow', () => {
  it('fails closed on a token that is not a signed compact JWS', () => {
    const issued = issuePass(INPUT, IN_PACK, CLOCK, seededRng(1));
    if (!issued.ok) throw new Error('issue failed');
    expect(() => passRow(issued.claims, 'header.payload')).toThrow(HalynError);
    expect(() => passRow(issued.claims, 'header.payload.')).toThrow(HalynError);
  });

  it('turns signed claims into an active `passes` row', async () => {
    const issued = issuePass(INPUT, IN_PACK, CLOCK, seededRng(1));
    if (!issued.ok) throw new Error('issue failed');
    const token = await signPass(issued.claims, (await testKeys('k1')).signer);
    const row = passRow(issued.claims, token);
    expect(PassRowSchema.parse(row)).toEqual(row);
    expect(row).toMatchObject({
      id: issued.claims.pid,
      tenant_id: 'ten_aero',
      customer_id: 'cus_saksham',
      assistant_numbers: [ASSISTANT_NUMBER],
      status: 'active',
      failures: 0,
      revoked_at: null,
      issued_at: new Date(NOW).toISOString(),
      expires_at: new Date(NOW + 7 * 86_400_000).toISOString(),
      issuer_sig: token.split('.')[2],
    });
  });
});
