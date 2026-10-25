import { describe, expect, it } from 'vitest';
import { aeroInPack, aeroUsPack, PACK_SHA } from './__fixtures__/packs';
import { HalynError } from './errors';
import {
  CompiledPolicyPackSchema,
  compilePolicyPack,
  packAction,
  POLICY_PACK_SCHEMA,
  type PolicyPackInput,
  PolicyPackSchema,
  validatePolicyPack,
} from './policy-pack';

type Mutation = (pack: PolicyPackInput) => void;
const loose = (pack: PolicyPackInput) => pack as unknown as Record<string, Record<string, unknown>>;

const INVALID: [string, Mutation][] = [
  ['a region/currency mismatch', (p) => void (p.currency = 'USD')],
  [
    'a critical action made pass-eligible',
    (p) => void (p.actions['transfer.new_payee'] = { tier: 3, pass_eligible: true }),
  ],
  [
    'a protective action above tier 0',
    (p) => void (p.actions['card.freeze'] = { tier: 1, protective: true, pass_eligible: true }),
  ],
  [
    'a protective money action',
    (p) => void (p.actions['transfer.saved'] = { tier: 0, protective: true, pass_eligible: false }),
  ],
  [
    'a protective read action',
    (p) => void (p.actions['card.freeze'] = { tier: 0, protective: true, read: true, pass_eligible: true }),
  ],
  [
    'a read action that moves money',
    (p) => void (p.actions['transfer.saved'] = { tier: 2, read: true, pass_eligible: false }),
  ],
  [
    'an amount limit on an action without an amount',
    (p) =>
      void (p.actions['emi.move_date'] = {
        tier: 2,
        limit: { amount_minor: 100, per: 'year' },
        pass_eligible: true,
      }),
  ],
  [
    'a first-24h cap on an action without an amount',
    (p) => void (p.actions['card.reset_pin'] = { tier: 3, cap_first_24h_minor: 100, pass_eligible: false }),
  ],
  [
    'a human-only threshold on an action without an amount',
    (p) =>
      void (p.actions['card.reset_pin'] = { tier: 3, human_only_above_minor: 100, pass_eligible: false }),
  ],
  [
    'tier 4 without hold_hours',
    (p) => void (p.actions['profile.change_mobile'] = { tier: 4, pass_eligible: false }),
  ],
  [
    'hold_hours below tier 4',
    (p) => void (p.actions['transfer.saved'] = { tier: 2, hold_hours: 24, pass_eligible: false }),
  ],
  [
    'a limit with neither amount nor count',
    (p) => void (p.actions['fee.waive'] = { tier: 1, limit: { per: 'year' }, pass_eligible: true }),
  ],
  ['tier 5', (p) => void (p.actions['fee.waive'] = { tier: 5, pass_eligible: true })],
  ['duplicate confirm channels', (p) => void (p.confirm.channels = ['passkey', 'passkey'])],
  ['an unknown confirm channel', (p) => void (loose(p).confirm!.channels = ['sms'])],
  ['an unknown action', (p) => void (loose(p).actions!['card.melt'] = { tier: 0, pass_eligible: false })],
  ['an unknown top-level field', (p) => void ((p as unknown as Record<string, unknown>).extra = true)],
  [
    'an unknown action field',
    (p) => void (loose(p).actions!['card.freeze'] = { tier: 0, pass_eligible: true, colour: 'red' }),
  ],
  ['no actions', (p) => void (p.actions = {})],
  ['a coaching threshold above 1', (p) => void (p.coaching.threshold = 1.2)],
  ['a negative signal weight', (p) => void (p.signals.unusual_hour = -1)],
  ['a lower-case env var name', (p) => void (p.handoff.specialist_number_env = 'specialist')],
];

describe('PolicyPackSchema', () => {
  it('accepts both packs', () => {
    expect(PolicyPackSchema.safeParse(aeroInPack()).success).toBe(true);
    expect(PolicyPackSchema.safeParse(aeroUsPack()).success).toBe(true);
  });

  it.each(INVALID)('rejects %s', (_, mutate) => {
    const pack = aeroInPack();
    mutate(pack);
    expect(PolicyPackSchema.safeParse(pack).success).toBe(false);
  });
});

describe('validatePolicyPack', () => {
  it('returns the parsed pack', () => {
    const result = validatePolicyPack(aeroUsPack());
    expect(result.ok && result.pack.region).toBe('US');
  });
  it('explains what is wrong and where', () => {
    const pack = aeroInPack();
    pack.actions['transfer.new_payee'] = { tier: 3, pass_eligible: true };
    const result = validatePolicyPack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/transfer\.new_payee.*critical/s);
  });
});

describe('compilePolicyPack', () => {
  const compiled = compilePolicyPack(PolicyPackSchema.parse(aeroInPack()), PACK_SHA);

  it('stamps the schema id and source hash and sorts actions', () => {
    expect(compiled.schema).toBe(POLICY_PACK_SCHEMA);
    expect(compiled.source_sha).toBe(PACK_SHA);
    expect(Object.keys(compiled.actions)).toEqual(Object.keys(compiled.actions).sort());
    expect(Object.keys(compiled.actions)).toHaveLength(16);
    expect(CompiledPolicyPackSchema.parse(compiled)).toEqual(compiled);
  });

  it('normalises agent actions with explicit defaults', () => {
    expect(compiled.actions['card.freeze']).toEqual({
      perimeter: 'agent',
      tier: 0,
      read: false,
      protective: true,
      pass_eligible: true,
      moves_money: false,
      critical: false,
      limit: null,
      cap_first_24h_minor: null,
      hold_hours: null,
      human_only_above_minor: null,
    });
    expect(compiled.actions['fee.waive']?.limit).toEqual({ amount_minor: 100000, count: 1, per: 'year' });
    expect(compiled.actions['emi.move_date']?.limit).toEqual({ amount_minor: null, count: 1, per: 'year' });
    expect(compiled.actions['transfer.new_payee']).toMatchObject({
      tier: 3,
      critical: true,
      moves_money: true,
      cap_first_24h_minor: 1000000,
    });
  });

  it('normalises human-only actions', () => {
    expect(compiled.actions['account.close']).toEqual({
      perimeter: 'human_only',
      tier: null,
      read: false,
      protective: false,
      pass_eligible: false,
      moves_money: false,
      critical: true,
      limit: null,
      cap_first_24h_minor: null,
      hold_hours: null,
      human_only_above_minor: null,
    });
  });

  it('does not depend on the order actions were written in', () => {
    const pack = aeroInPack();
    pack.actions = Object.fromEntries(Object.entries(pack.actions).reverse());
    expect(JSON.stringify(compilePolicyPack(PolicyPackSchema.parse(pack), PACK_SHA))).toBe(
      JSON.stringify(compiled),
    );
  });

  it('fails closed on a bad source hash', () => {
    expect(() => compilePolicyPack(PolicyPackSchema.parse(aeroInPack()), 'not-a-sha')).toThrow(HalynError);
  });

  it('rejects compiled packs whose human-only actions carry a tier', () => {
    const bad = structuredCloneJson(compiled) as { actions: Record<string, Record<string, unknown>> };
    bad.actions['account.close']!.tier = 3;
    expect(CompiledPolicyPackSchema.safeParse(bad).success).toBe(false);
  });

  // KV is not a trust boundary we control: a hand-edited or stale compiled pack must not be able to relax
  // a rule the code fixes (invariant 5, money-moving actions, protective actions).
  it.each<[string, string, Record<string, unknown>]>([
    ['a critical action made pass-eligible', 'transfer.new_payee', { pass_eligible: true }],
    ['a critical action marked not critical', 'transfer.new_payee', { critical: false }],
    ['a money-moving action marked not moving money', 'transfer.saved', { moves_money: false }],
    ['a human-only critical action marked not critical', 'account.close', { critical: false }],
    ['a protective action above tier 0', 'card.freeze', { tier: 2 }],
  ])('rejects a tampered compiled pack: %s', (_, action, patch) => {
    const bad = structuredCloneJson(compiled) as { actions: Record<string, Record<string, unknown>> };
    Object.assign(bad.actions[action]!, patch);
    expect(CompiledPolicyPackSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a compiled pack whose currency does not match its region', () => {
    const bad = { ...compiled, currency: 'USD' };
    expect(CompiledPolicyPackSchema.safeParse(bad).success).toBe(false);
  });
});

describe('packAction', () => {
  const inPack = compilePolicyPack(PolicyPackSchema.parse(aeroInPack()), PACK_SHA);
  const usPack = compilePolicyPack(PolicyPackSchema.parse(aeroUsPack()), PACK_SHA);
  it('finds an action offered in the region and nothing else', () => {
    expect(packAction(inPack, 'transfer.new_payee')?.tier).toBe(3);
    expect(packAction(inPack, 'wire.new')).toBeUndefined();
    expect(packAction(usPack, 'wire.new')?.human_only_above_minor).toBe(500000);
  });
});

function structuredCloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
