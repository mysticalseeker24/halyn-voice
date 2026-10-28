// Pre-push secret check (docs/HANDOFF.md convention 3): no literal .env value in the unpushed commits, and CI's
// secret-pattern scan over HEAD. Prints names only, never values. Exit 1 on a finding.
// Usage: node scripts/check-secrets.mjs [base=origin/main]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const base = process.argv[2] ?? 'origin/main';
// Public values that are expected in commits (key id, URLs, the two business numbers, Bolna agent ids — useless
// without the Bolna key and recorded in docs/STATE.md on purpose).
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
]);
const PATTERN = String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----|sk[-_][A-Za-z0-9_-]{20,}|bn-[0-9a-f]{32}|cfat_[A-Za-z0-9]{20,}`;

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const log = git(['log', '-p', `${base}..HEAD`]);
const env = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const leaks = Object.entries(env)
  .filter(([name, value]) => !PUBLIC.has(name) && value.length >= 8 && log.includes(value))
  .map(([name]) => name);

const scan = () => {
  try {
    return git(['grep', '-lE', '--', PATTERN, 'HEAD', '--', ':!*.md', ':!scripts/hooks/*']);
  } catch {
    return ''; // git grep exits 1 when nothing matches
  }
};
const patternHits = scan();

if (leaks.length || patternHits.trim()) {
  if (leaks.length) console.error(`.env values in ${base}..HEAD: ${leaks.join(', ')}`);
  if (patternHits.trim()) console.error(`secret-like strings in:\n${patternHits}`);
  process.exit(1);
}
console.log(`secrets: clean (${base}..HEAD)`);
