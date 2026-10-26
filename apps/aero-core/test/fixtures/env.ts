import type { D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { type Region, SEED_TENANT, seedStatements } from '../../src/seed';

// The Miniflare env from vitest.config.ts: the D1 binding, the tenant, the throwaway JWKS and its private half.

export interface TestEnv {
  DB: D1Database;
  AERO_TENANT_ID: string;
  HALYN_PUBLIC_JWKS: string;
  TEST_SIGNING_KEY: string;
  TEST_MIGRATIONS: D1Migration[];
}

export function testEnv(): TestEnv {
  return env as unknown as TestEnv;
}

export const TENANT = SEED_TENANT;

/** A customer id no other test uses (test files may share one D1). */
export function uniqueCustomer(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `cus_t${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A fresh customer seeded from the region's demo template (same rows as seed/seed.sql). */
export async function seedCustomer(region: Region = 'IN', customer = uniqueCustomer()): Promise<string> {
  const db = testEnv().DB;
  await db.batch(seedStatements([{ tenant: TENANT, customer, region }]).map((sql) => db.prepare(sql)));
  return customer;
}

export async function rows<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T[]> {
  const result = await testEnv()
    .DB.prepare(sql)
    .bind(...binds)
    .all<T>();
  return result.results;
}
