// Vitest global setup for apps/api's DB suite (ADR-013), run in Node: bring halyn_test to the latest migration, or
// say loudly that the suite skips because no TiDB credentials are configured.
import { migrateDatabase } from './db-migrate';
import { loadDotEnv, tidbUrl } from './lib/tidb';

export default async function setup(): Promise<void> {
  loadDotEnv();
  if (!tidbUrl('halyn_test')) {
    console.warn(
      '\n⚠ DB suite SKIPPED: no TiDB credentials (set TIDB_* in .env, or TIDB_TEST_DATABASE_URL in CI). ADR-013.\n',
    );
    return;
  }
  await migrateDatabase('halyn_test');
}
