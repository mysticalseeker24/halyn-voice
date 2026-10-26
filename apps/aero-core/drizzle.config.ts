import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @halyn/aero-core db:generate` writes SQL migrations from src/db/schema.ts into migrations/ (committed).
// Wrangler applies them: `wrangler d1 migrations apply aero-core --local` (tests apply them in Miniflare).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
