// pnpm db:migrate [--db halyn_dev|halyn_test|halyn] — create the database if needed and apply apps/api/drizzle
// migrations over TiDB's HTTP driver (ADR-013). Default halyn_dev. Aero Core's D1 migrations are Step 6.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect } from '@tidbcloud/serverless';
import { drizzle } from 'drizzle-orm/tidb-serverless';
import { migrate } from 'drizzle-orm/tidb-serverless/migrator';
import { type DatabaseName, loadDotEnv, parseDbArg, repoRoot, tidbUrl } from './lib/tidb';

export const MIGRATIONS_FOLDER = join(repoRoot, 'apps', 'api', 'drizzle');

/** Create `database` if missing and bring it to the latest migration. Idempotent. */
export async function migrateDatabase(database: DatabaseName, env = process.env): Promise<void> {
  const server = tidbUrl(null, env);
  const url = tidbUrl(database, env);
  if (!server || !url)
    throw new Error('TiDB is not configured: set TIDB_HOST, TIDB_USERNAME and TIDB_PASSWORD in .env');
  await connect({ url: server }).execute(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  await migrate(drizzle({ client: connect({ url }) }), { migrationsFolder: MIGRATIONS_FOLDER });
}

async function main(args: string[]): Promise<void> {
  loadDotEnv();
  const database = parseDbArg(args);
  await migrateDatabase(database);
  console.log(`✓ TiDB ${database}: migrations from apps/api/drizzle applied`);
  console.log('  D1 (Aero Core) migrations arrive with PROMPTS.md Step 6.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`db:migrate failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
