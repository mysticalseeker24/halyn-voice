import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  ACTION_PARAMS,
  ActionIdSchema,
  CompiledPolicyPackSchema,
  compilePolicyPack,
  type PolicyPack,
  validatePolicyPack,
} from '../src/index';
import { clone, policyPackFiles, readRepoYaml } from './repo';

const SHA = '0'.repeat(64);
const files = policyPackFiles();
const raw = (file: string) => readRepoYaml(`policy-packs/${file}`) as Record<string, unknown>;

function parsed(file: string): PolicyPack {
  const result = validatePolicyPack(raw(file));
  if (!result.ok) throw new Error(`${file}: ${result.error}`);
  return result.pack;
}

describe('policy-packs/*.yaml', () => {
  it('has the India and US packs', () => {
    expect(files).toEqual(['aero-in.yaml', 'aero-us.yaml']);
  });

  describe.each(files)('%s', (file) => {
    it('validates, and its pack id matches the file name', () => {
      expect(`${parsed(file).pack}.yaml`).toBe(file);
    });

    it('compiles to a pack the runtime schema accepts', () => {
      const compiled = compilePolicyPack(parsed(file), SHA);
      expect(CompiledPolicyPackSchema.parse(compiled)).toEqual(compiled);
      expect(Object.keys(compiled.actions)).toHaveLength(Object.keys(parsed(file).actions).length);
    });

    it('has a params schema for every action it lists', () => {
      const actions = Object.keys(raw(file).actions as object);
      for (const action of actions) {
        expect(ActionIdSchema.safeParse(action).success, action).toBe(true);
        expect(ACTION_PARAMS[action as keyof typeof ACTION_PARAMS], action).toBeDefined();
      }
    });
  });

  it('every ActionId is offered by at least one pack', () => {
    const offered = new Set(files.flatMap((f) => Object.keys(raw(f).actions as object)));
    expect(ACTION_IDS.filter((a) => !offered.has(a))).toEqual([]);
  });

  it.each<[string, (pack: Record<string, Record<string, Record<string, unknown>>>) => void]>([
    [
      'a critical action made pass-eligible',
      (p) => void (p.actions!['transfer.new_payee']!.pass_eligible = true),
    ],
    ['a region/currency mismatch', (p) => void ((p as Record<string, unknown>).currency = 'USD')],
    ['an unknown action', (p) => void (p.actions!['card.melt'] = { tier: 0, pass_eligible: false })],
    [
      'a protective money action',
      (p) => void (p.actions!['transfer.saved'] = { tier: 0, protective: true, pass_eligible: false }),
    ],
  ])('aero-in.yaml with %s fails to compile', (_, mutate) => {
    const pack = clone(raw('aero-in.yaml')) as Record<string, Record<string, Record<string, unknown>>>;
    mutate(pack);
    expect(validatePolicyPack(pack).ok).toBe(false);
  });
});
