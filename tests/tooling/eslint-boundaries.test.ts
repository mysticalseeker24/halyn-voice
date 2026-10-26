import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// Guards the purity rule in eslint.config.mjs: gate/grants/ledger/pass and packages/shared stay free of I/O.
const root = fileURLToPath(new URL('../..', import.meta.url));
// The probe files are virtual (not in any tsconfig project), so lint them without type information.
const eslint = new ESLint({ cwd: root, overrideConfig: tseslint.configs.disableTypeChecked });

async function restrictions(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return (result?.messages ?? []).flatMap((m) => (m.ruleId?.startsWith('no-restricted-') ? [m.ruleId] : []));
}

describe('pure-module lint boundary', () => {
  it.each([
    ['apps/api/src/gate/probe.ts', "import { db } from '../db/client';\nexport const x = db;"],
    ['apps/api/src/grants/probe.ts', "import { send } from '../bolna';\nexport const x = send;"],
    ['apps/api/src/ledger/probe.ts', "import { HubDO } from '../hub/hub-do';\nexport const x = HubDO;"],
    ['apps/api/src/pass/probe.ts', "import { env } from 'cloudflare:workers';\nexport const x = env;"],
    [
      'packages/shared/src/probe.ts',
      "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;",
    ],
    ['packages/shared/src/probe.ts', "import { Hono } from 'hono';\nexport const x = Hono;"],
    ['apps/api/src/signals/coaching-lexicon.ts', "import { db } from '../db/client';\nexport const x = db;"],
  ])('%s rejects an I/O import', async (file, code) => {
    expect(await restrictions(code, file)).toContain('no-restricted-imports');
  });

  it.each([
    ['apps/api/src/gate/probe.ts', 'export const t = Date.now();', 'no-restricted-properties'],
    ['apps/api/src/pass/probe.ts', 'export const r = Math.random();', 'no-restricted-properties'],
    ['apps/api/src/grants/probe.ts', 'export const id = crypto.randomUUID();', 'no-restricted-properties'],
    ['apps/api/src/ledger/probe.ts', 'export const d = new Date();', 'no-restricted-syntax'],
    ['apps/api/src/signals/distress-lexicon.ts', 'export const t = Date.now();', 'no-restricted-properties'],
    [
      'packages/shared/src/probe.ts',
      "export const p = fetch('https://example.com');",
      'no-restricted-globals',
    ],
  ])('%s rejects clock, randomness and network: %s', async (file, code, rule) => {
    expect(await restrictions(code, file)).toContain(rule);
  });

  it('allows pure code that takes its clock and data as inputs', async () => {
    const code = [
      "import type { Clock } from './clock';",
      'export const at = (clock: Clock): string => new Date(clock.now()).toISOString();',
    ].join('\n');
    expect(await restrictions(code, 'apps/api/src/gate/probe.ts')).toEqual([]);
  });

  it('does not restrict I/O layers outside the pure folders', async () => {
    const code = "import { db } from '../db/client';\nexport const t = Date.now() + Number(Boolean(db));";
    expect(await restrictions(code, 'apps/api/src/tools/probe.ts')).toEqual([]);
    // Only the lexicon files in signals/ are pure; the Sarvam layer (Step 11) does I/O.
    expect(await restrictions(code, 'apps/api/src/signals/sarvam.ts')).toEqual([]);
  });
});
