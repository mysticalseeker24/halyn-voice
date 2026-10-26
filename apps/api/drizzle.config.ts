import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @halyn/api db:generate` writes SQL migrations from src/db/schema.ts into drizzle/ (committed).
// They are applied with `pnpm db:migrate --db halyn_dev|halyn_test|halyn` (scripts/db-migrate.ts), never by hand.
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
