import { applyD1Migrations } from 'cloudflare:test';
import { testEnv } from './fixtures/env';

// Runs before every test file: the committed migrations (migrations/*.sql) on the Miniflare D1. Idempotent.
await applyD1Migrations(testEnv().DB, testEnv().TEST_MIGRATIONS);
