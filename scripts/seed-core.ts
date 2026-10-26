// pnpm seed:core [--write-only] [--remote --yes]
// Aero Core's D1 seed (docs/DATA_MODEL.md "Seed"): regenerates apps/aero-core/seed/seed.sql from
// apps/aero-core/src/seed (deterministic; a unit test keeps the committed file equal to it), then applies the D1
// migrations and the seed to the LOCAL database (wrangler's .wrangler/state, used by `wrangler dev`). Re-running resets
// the demo customers' cards, fees, loan, payees, balances and transactions; it never touches used_grants.
// --write-only only regenerates the file. --remote targets the deployed `aero-core` D1 and needs --yes (deploying and
// writing to Cloudflare needs Saksham's go-ahead in the session).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSeedSql } from '../apps/aero-core/src/seed/seed-sql';
import { repoRoot } from './lib/tidb';

export type SeedCoreTarget = 'local' | 'remote' | 'none';

const OPTIONS = ['--write-only', '--remote', '--yes'];

export function parseSeedCoreArgs(args: readonly string[]): SeedCoreTarget {
  const unknown = args.find((a) => !OPTIONS.includes(a));
  if (unknown !== undefined) throw new Error(`unknown option ${unknown} (expected ${OPTIONS.join(', ')})`);
  if (args.includes('--write-only')) {
    if (args.includes('--remote')) throw new Error('--write-only and --remote cannot be combined');
    return 'none';
  }
  if (args.includes('--remote')) {
    if (!args.includes('--yes'))
      throw new Error('--remote writes to the deployed Aero Core D1: add --yes (only with go-ahead)');
    return 'remote';
  }
  return 'local';
}

/** The wrangler commands for a target, run in apps/aero-core. */
export function wranglerSteps(target: Exclude<SeedCoreTarget, 'none'>): string[][] {
  const where = `--${target}`;
  return [
    ['wrangler', 'd1', 'migrations', 'apply', 'aero-core', where],
    ['wrangler', 'd1', 'execute', 'aero-core', where, '--file', 'seed/seed.sql'],
  ];
}

function main(args: string[]): void {
  const target = parseSeedCoreArgs(args);
  const file = join(repoRoot, 'apps', 'aero-core', 'seed', 'seed.sql');
  writeFileSync(file, buildSeedSql(), 'utf8');
  console.log('✓ wrote apps/aero-core/seed/seed.sql');
  if (target === 'none') return;
  for (const step of wranglerSteps(target)) {
    // One command line through the shell (pnpm is a .cmd shim on Windows). Every token is a fixed string above,
    // never user input.
    const command = ['pnpm', '--filter', '@halyn/aero-core', 'exec', ...step].join(' ');
    const result = spawnSync(command, { cwd: repoRoot, stdio: 'inherit', shell: true });
    if (result.status !== 0) throw new Error(`${step.join(' ')} failed`);
  }
  console.log(`✓ seeded the ${target} Aero Core D1 (tenant ten_aero: cus_saksham, cus_saksham_us)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`seed:core failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
