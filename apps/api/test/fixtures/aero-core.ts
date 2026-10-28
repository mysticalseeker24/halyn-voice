import type { Clock, Rng } from '@halyn/shared';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
// The real Aero Core (apps/aero-core), run in-process against a Miniflare D1: the scenario runner and the integration
// tests never mock it (docs/TESTING.md). Its grant check trusts this run's throwaway JWKS (vitest.config.ts).
import { createApp } from '../../../aero-core/src/app';
import { seedStatements } from '../../../aero-core/src/seed';
import type { CoreTransport } from '../../src/core-client/client';

interface AeroTestEnv {
  AERO_DB: D1Database;
  HALYN_PUBLIC_JWKS: string;
  TEST_AERO_MIGRATIONS: D1Migration[];
}

const testEnv = env as unknown as AeroTestEnv;
let migrated: Promise<void> | null = null;

/** Apply Aero Core's committed migrations once per isolate. */
export function migrateAeroCore(): Promise<void> {
  migrated ??= applyD1Migrations(testEnv.AERO_DB, testEnv.TEST_AERO_MIGRATIONS);
  return migrated;
}

export interface AeroCoreHarness {
  transport: CoreTransport;
  /** Every request Aero Core received, in order (method, path, whether it carried a grant, status). */
  calls: { method: string; path: string; granted: boolean; status: number }[];
  /** Run SQL against Aero Core's D1 (assertions only). */
  rows<T>(sql: string, ...binds: unknown[]): Promise<T[]>;
}

/**
 * Aero Core for one tenant: its own seeded demo customers (cus_saksham IN, cus_saksham_us US) and the given clock,
 * so grants signed with the test clock verify. Tenants keep tests apart in the shared D1.
 */
export async function aeroCore(tenant: string, clock: Clock, rng: Rng): Promise<AeroCoreHarness> {
  await migrateAeroCore();
  const db = testEnv.AERO_DB;
  const seed = seedStatements([
    { tenant, customer: 'cus_saksham', region: 'IN' },
    { tenant, customer: 'cus_saksham_us', region: 'US' },
  ]);
  await db.batch(seed.map((sql) => db.prepare(sql)));
  const app = createApp({ clock, rng: { bytes: (n) => rng.bytes(n) } });
  const coreEnv = { DB: db, HALYN_PUBLIC_JWKS: testEnv.HALYN_PUBLIC_JWKS, AERO_TENANT_ID: tenant };
  const calls: AeroCoreHarness['calls'] = [];
  return {
    calls,
    transport: async (request) => {
      const url = new URL(request.url);
      const res = await app.fetch(request, coreEnv as unknown as Env);
      calls.push({
        method: request.method,
        path: url.pathname,
        granted: request.headers.has('x-halyn-grant'),
        status: res.status,
      });
      return res;
    },
    rows: async <T>(sql: string, ...binds: unknown[]) =>
      (
        await db
          .prepare(sql)
          .bind(...binds)
          .all<T>()
      ).results,
  };
}
