// Secrets scan over ALL history (every commit on every ref). Prints names and commit counts only, never values.
// Run from the repo root: node scripts/ops/history-secrets.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const PUBLIC = new Set([
  'BOLNA_AERO_AGENT_ID',
  'BOLNA_AERO_EN_AGENT_ID',
  'BOLNA_ASSISTANT_AGENT_ID',
  'BOLNA_CONFIRM_AGENT_ID',
  'HALYN_API_URL',
  'HALYN_KEY_ID',
  'NEXT_PUBLIC_API_URL',
  'NUMBER_A',
  'NUMBER_B',
  'RP_ID',
  'WEB_ORIGIN',
  'DEFAULT_TENANT_ID',
  'DEFAULT_REGION',
]);
const PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|sk[-_][A-Za-z0-9_-]{20,}|bn-[0-9a-f]{32}|cfat_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|mysql:\/\/[^\s'"]+:[^\s'"@]+@/;

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const log = git(['log', '-p', '--all', '--format=commit %H']);
const commits = log.split(/^commit (?=[0-9a-f]{40}$)/m).filter(Boolean);
console.log(`commits scanned: ${commits.length}`);

const env = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
for (const [name, value] of Object.entries(env)) {
  if (PUBLIC.has(name) || value.length < 8) continue;
  const hits = commits.filter((c) => c.includes(value)).length;
  if (hits) console.log(`ENV VALUE FOUND: ${name} in ${hits} commit(s)`);
}
const patternHits = new Map();
for (const c of commits) {
  const sha = c.slice(0, 10);
  let file = '';
  for (const line of c.split('\n')) {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (
      line.startsWith('+') &&
      PATTERN.test(line) &&
      !file.endsWith('.md') &&
      !file.startsWith('scripts/hooks/')
    )
      patternHits.set(`${file}`, (patternHits.get(file) ?? []).concat(sha));
  }
}
for (const [file, shas] of patternHits) console.log(`PATTERN in ${file}: ${shas.slice(0, 3).join(', ')}`);
console.log(patternHits.size ? 'history: CHECK the hits above' : 'history: no secret-like additions');
