// TiDB connection settings for repo scripts (db:migrate, seed) and the gated DB tests (ADR-013). Credentials come from
// .env (TIDB_HOST, TIDB_PORT, TIDB_USERNAME, TIDB_PASSWORD) or, in CI, TIDB_TEST_DATABASE_URL. Never printed.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** halyn_dev: wrangler dev · halyn_test: DB-backed integration tests · halyn: the demo (Step 8). */
export const DATABASES = ['halyn_dev', 'halyn_test', 'halyn'] as const;
export type DatabaseName = (typeof DATABASES)[number];

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Load .env into process.env if it exists (variables already set win). */
export function loadDotEnv(): void {
  const path = join(repoRoot, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}

function isDatabaseName(value: string): value is DatabaseName {
  return (DATABASES as readonly string[]).includes(value);
}

/** `--db <name>` (default halyn_dev). Anything else is refused, so a typo can't create a stray database. */
export function parseDbArg(args: readonly string[]): DatabaseName {
  const i = args.indexOf('--db');
  if (i === -1) return 'halyn_dev';
  const value = args[i + 1] ?? '';
  if (!isDatabaseName(value)) throw new Error(`--db must be one of ${DATABASES.join(', ')}`);
  return value;
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `mysql://user:pass@host:port[/database]` from the TIDB_* settings, or from TIDB_TEST_DATABASE_URL for halyn_test
 * (CI). null when neither is configured.
 */
export function tidbUrl(database: DatabaseName | null, env: Env = process.env): string | null {
  const { TIDB_HOST, TIDB_PORT, TIDB_USERNAME, TIDB_PASSWORD, TIDB_TEST_DATABASE_URL } = env;
  if (TIDB_HOST && TIDB_USERNAME && TIDB_PASSWORD) {
    const base = `mysql://${encodeURIComponent(TIDB_USERNAME)}:${encodeURIComponent(TIDB_PASSWORD)}@${TIDB_HOST}:${TIDB_PORT || '4000'}`;
    return database ? `${base}/${database}` : base;
  }
  if (TIDB_TEST_DATABASE_URL && (database === 'halyn_test' || database === null)) {
    const url = new URL(TIDB_TEST_DATABASE_URL);
    if (database === null) url.pathname = '';
    return url.toString().replace(/\/$/, '');
  }
  return null;
}
