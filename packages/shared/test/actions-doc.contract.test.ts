import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  ACTION_PARAMS,
  type ActionId,
  isCriticalAction,
  movesMoney,
  type PolicyPackInput,
} from '../src/index';
import { readRepoFile, readRepoYaml } from './repo';

// docs/ACTIONS.md is the human-readable catalog; this keeps it identical to the code and the packs.
interface Row {
  action: string;
  params: string[];
  kind: string;
  money: string;
  critical: string;
  IN: string;
  US: string;
}

function catalogRows(): Row[] {
  return readRepoFile('docs/ACTIONS.md')
    .split('\n')
    .filter((line) => line.startsWith('| `') && line.split('|').length === 11)
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const [action = '', params = '', kind = '', money = '', critical = '', IN = '', US = ''] = cells;
      return {
        action: action.replaceAll('`', ''),
        params: params.split(',').map((p) => p.trim().replaceAll('`', '')),
        kind,
        money,
        critical,
        IN,
        US,
      };
    });
}

function packCell(file: string, action: ActionId): string {
  const pack = readRepoYaml(file) as PolicyPackInput;
  const entry = pack.actions[action];
  if (!entry) return '—';
  return 'tier' in entry ? String(entry.tier) : 'human';
}

function kindOf(file: string, action: ActionId): string | undefined {
  const entry = (readRepoYaml(file) as PolicyPackInput).actions[action];
  if (!entry || !('tier' in entry)) return undefined;
  if (entry.protective) return 'protective';
  return entry.read ? 'read' : 'write';
}

const rows = catalogRows();
const byAction = new Map(rows.map((r) => [r.action, r]));

describe('docs/ACTIONS.md vs code and packs', () => {
  it('lists every ActionId exactly once, in order', () => {
    expect(rows.map((r) => r.action)).toEqual([...ACTION_IDS]);
  });

  it.each([...ACTION_IDS])('%s: params, flags and tiers match', (action) => {
    const row = byAction.get(action);
    expect(row).toBeDefined();
    const shape = ACTION_PARAMS[action].shape as Record<
      string,
      { safeParse(v: unknown): { success: boolean } }
    >;
    const documented = row?.params.map((p) => p.replace(/\?$/, ''));
    expect(documented?.slice().sort()).toEqual(Object.keys(shape).sort());
    for (const p of row?.params ?? []) {
      // `name?` marks optional params: the schema must accept the field being absent.
      const optional = shape[p.replace(/\?$/, '')]?.safeParse(undefined).success;
      expect(optional, `${action}.${p}`).toBe(p.endsWith('?'));
    }
    expect(row?.money).toBe(movesMoney(action) ? 'yes' : 'no');
    expect(row?.critical).toBe(isCriticalAction(action) ? 'yes' : 'no');
    expect(row?.IN).toBe(packCell('policy-packs/aero-in.yaml', action));
    expect(row?.US).toBe(packCell('policy-packs/aero-us.yaml', action));
    const kinds = [kindOf('policy-packs/aero-in.yaml', action), kindOf('policy-packs/aero-us.yaml', action)];
    for (const kind of kinds) if (kind) expect(row?.kind).toBe(kind);
    if (kinds.every((k) => k === undefined)) expect(row?.kind).toBe('write');
  });
});
