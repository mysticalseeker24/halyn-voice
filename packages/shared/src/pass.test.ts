import { describe, expect, it } from 'vitest';
import { aeroInPack, aeroUsPack, PACK_SHA } from './__fixtures__/packs';
import {
  PASS_CODE,
  PASS_MAX_LIFETIME_SECONDS,
  PASS_VERSION,
  type PassClaimsInput,
  PassClaimsSchema,
  PassCodeInputSchema,
  PassCodeSchema,
  PassHeaderSchema,
  passScopesAllowed,
  PassStatusSchema,
} from './pass';
import { compilePolicyPack, PolicyPackSchema } from './policy-pack';

// docs/PASS.md example, with the seed's scopes (docs/DATA_MODEL.md).
const claims = (): PassClaimsInput => ({
  v: 'halyn-pass/0.1',
  pid: 'pass_demo',
  tenant: 'ten_aero',
  sub: 'cus_saksham',
  assistant: { name: "Saksham's Assistant", numbers: ['+918065356379'] },
  scopes: [{ action: 'statement.view' }, { action: 'card.freeze' }, { action: 'emi.move_date', max_uses: 1 }],
  iat: 1761400000,
  exp: 1762004800,
  cnf: { customer_passkey_sig: 'c2lnbmF0dXJlLW92ZXItY2xhaW1z' },
});

describe('PassClaimsSchema', () => {
  it('accepts the documented claims', () => {
    expect(PASS_VERSION).toBe('halyn-pass/0.1');
    expect(PassClaimsSchema.parse(claims())).toEqual(claims());
  });

  it.each<[string, (c: PassClaimsInput) => void]>([
    ['a critical action in scope', (c) => void c.scopes.push({ action: 'transfer.new_payee' })],
    ['account.close in scope', (c) => void c.scopes.push({ action: 'account.close' })],
    ['the same action twice', (c) => void c.scopes.push({ action: 'card.freeze' })],
    ['no scopes', (c) => void (c.scopes = [])],
    ['zero max_uses', (c) => void (c.scopes = [{ action: 'card.freeze', max_uses: 0 }])],
    ['exp before iat', (c) => void (c.exp = c.iat)],
    ['a lifetime over 30 days', (c) => void (c.exp = c.iat + PASS_MAX_LIFETIME_SECONDS + 1)],
    ['another version', (c) => void ((c as { v: string }).v = 'halyn-pass/0.2')],
    ['a number that is not E.164', (c) => void (c.assistant.numbers = ['08065356379'])],
    ['no calling numbers', (c) => void (c.assistant.numbers = [])],
    ['a repeated calling number', (c) => void (c.assistant.numbers = ['+918065356379', '+918065356379'])],
    ['an unknown claim', (c) => void ((c as unknown as Record<string, unknown>).admin = true)],
    ['a pass id without the pass_ prefix', (c) => void (c.pid = 'tok_demo')],
    ['a signature that is not base64url', (c) => void (c.cnf.customer_passkey_sig = 'a+b/c=')],
  ])('rejects %s', (_, mutate) => {
    const c = claims();
    mutate(c);
    expect(PassClaimsSchema.safeParse(c).success).toBe(false);
  });

  it('allows exactly 30 days', () => {
    const c = claims();
    c.exp = c.iat + PASS_MAX_LIFETIME_SECONDS;
    expect(PassClaimsSchema.safeParse(c).success).toBe(true);
  });
});

describe('Pass header, status and codes', () => {
  it('pins EdDSA and the Pass media type', () => {
    expect(
      PassHeaderSchema.safeParse({ alg: 'EdDSA', kid: 'halyn-2026-10', typ: 'halyn-pass+jwt' }).success,
    ).toBe(true);
    expect(
      PassHeaderSchema.safeParse({ alg: 'HS256', kid: 'halyn-2026-10', typ: 'halyn-pass+jwt' }).success,
    ).toBe(false);
    expect(
      PassHeaderSchema.safeParse({ alg: 'EdDSA', kid: 'halyn-2026-10', typ: 'halyn-grant+jwt' }).success,
    ).toBe(false);
  });

  it('lists the statuses', () => {
    expect(PassStatusSchema.options).toEqual(['active', 'revoked', 'locked', 'expired']);
  });

  it('defines one-time codes as 6 digits, 5 minutes, 5 failures', () => {
    expect(PASS_CODE).toEqual({ digits: 6, ttl_seconds: 300, max_failures: 5 });
    expect(PassCodeSchema.safeParse('472915').success).toBe(true);
    expect(PassCodeSchema.safeParse('47291').success).toBe(false);
  });

  it.each([
    ['472915', '472915'],
    ['4 7 2 9 1 5', '472915'],
    ['472-915', '472915'],
  ])('normalises the spoken code %j', (input, code) => expect(PassCodeInputSchema.parse(input)).toBe(code));

  it.each(['47291', '4729150', 'abcdef', '4 7 2 9 1'])('rejects the code %j', (input) =>
    expect(PassCodeInputSchema.safeParse(input).success).toBe(false),
  );
});

describe('passScopesAllowed', () => {
  const inPack = compilePolicyPack(PolicyPackSchema.parse(aeroInPack()), PACK_SHA);
  const usPack = compilePolicyPack(PolicyPackSchema.parse(aeroUsPack()), PACK_SHA);

  it('accepts pass-eligible actions of the pack', () => {
    expect(passScopesAllowed(claims().scopes, inPack)).toEqual({ ok: true });
  });

  it('rejects actions the pack does not offer or does not allow in a Pass', () => {
    expect(passScopesAllowed([{ action: 'transfer.saved' }, { action: 'card.freeze' }], inPack)).toEqual({
      ok: false,
      rejected: ['transfer.saved'],
    });
    expect(passScopesAllowed([{ action: 'emi.move_date' }], usPack)).toEqual({
      ok: false,
      rejected: ['emi.move_date'],
    });
  });
});
