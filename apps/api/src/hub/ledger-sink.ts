import type { LedgerEntry } from '@halyn/shared';
import { createDb } from '../db/client';
import { insertLedgerEntries } from '../db/queries';
import { DbEnvSchema, requireEnv } from '../env';

/** Where the Hub's ordered ledger outbox lands (TiDB in production; a fake in tests via runInDurableObject). */
export interface LedgerSink {
  /** Persist entries of one tenant, already in seq order. Must be idempotent per (tenant, seq). */
  persist(tenant_id: string, entries: readonly LedgerEntry[]): Promise<void>;
}

/** The TiDB sink. Missing or invalid configuration throws, so the outbox keeps the rows and retries later. */
export function tidbLedgerSink(env: unknown): LedgerSink {
  return {
    async persist(tenant_id, entries) {
      const { TIDB_DATABASE_URL } = requireEnv(env, DbEnvSchema);
      await insertLedgerEntries(createDb(TIDB_DATABASE_URL), tenant_id, entries);
    },
  };
}
