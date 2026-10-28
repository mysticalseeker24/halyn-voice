// pnpm exec tsx scripts/cf-secrets.ts <api|core> [--db=halyn_dev] [--yes]
// Puts the deployed Worker's secrets from .env with `wrangler secret bulk` (go-ahead first: it changes a deployed
// Worker). Prints names only; the temporary JSON lives in scripts/out/ (git-ignored) and is deleted at once.
// TIDB_DATABASE_URL is rewritten to the --db database (default halyn_dev, docs/STATE.md).
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, parseArgs, requireYes } from './bolna/lib';

const API = [
  'HALYN_TOOL_SECRET',
  'SESSION_SECRET',
  'TIDB_DATABASE_URL',
  'HALYN_SIGNING_KEY',
  'HALYN_PUBLIC_JWKS',
  'HALYN_KEY_ID',
  'PASS_CODE_PEPPER',
  'PHONE_HASH_PEPPER',
  'BOLNA_API_KEY',
  'SARVAM_API_KEY',
  'NUMBER_B',
  'CUSTOMER_PHONE',
  'BOLNA_CONFIRM_AGENT_ID',
] as const;
const CORE = ['HALYN_PUBLIC_JWKS'] as const;

loadEnv();
const args = parseArgs(process.argv.slice(2));
const target = args.positional[0];
if (target !== 'api' && target !== 'core') throw new Error('usage: cf-secrets.ts <api|core> [--db=…] [--yes]');
const names = target === 'api' ? API : CORE;
const values: Record<string, string> = {};
const skipped: string[] = [];
for (const name of names) {
  const value = process.env[name];
  if (!value) {
    skipped.push(name);
    continue;
  }
  values[name] = value;
}
if (values.TIDB_DATABASE_URL) {
  const url = new URL(values.TIDB_DATABASE_URL);
  url.pathname = `/${args.options.get('db') ?? 'halyn_dev'}`;
  values.TIDB_DATABASE_URL = url.toString();
}
console.log(`${target}: ${Object.keys(values).join(', ')}${skipped.length ? ` (not in .env, skipped: ${skipped.join(', ')})` : ''}`);
requireYes(args, `put ${Object.keys(values).length} secrets on the deployed ${target} Worker`);
if (args.flags.has('dry-run')) process.exit(0);

const pkg = target === 'api' ? '@halyn/api' : '@halyn/aero-core';
const file = resolve('scripts/out', `${target}-secrets.json`);
writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
try {
  const out = execFileSync('pnpm', ['--filter', pkg, 'exec', 'wrangler', 'secret', 'bulk', file], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  console.log(out.split('\n').filter((l) => /success|uploaded|error|fail/i.test(l)).join('\n'));
} finally {
  rmSync(file, { force: true });
}
