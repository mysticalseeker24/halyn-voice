import { HalynError, type LedgerEntry, LedgerEntrySchema, TenantIdSchema } from '@halyn/shared';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { TiDBServerlessDatabase } from 'drizzle-orm/tidb-serverless';
import type { PassRow } from '../pass';
import type * as schema from './schema';
import { customers, ledgerEntries, passes, policyPacks, TABLES, tenants } from './schema';

// Tenant-scoped helpers: every one takes tenant_id first and filters on it (invariant 8). They return Drizzle
// builders (awaitable), so callers `await` them and tests can read the SQL offline with `.toSQL()`.

/** The TiDB database (createDb) or Drizzle's offline mock of it in tests. */
type AnyDb = TiDBServerlessDatabase<typeof schema>;

function tenant(tenant_id: string): string {
  if (!TenantIdSchema.safeParse(tenant_id).success)
    throw new HalynError('E_FAIL_CLOSED', 'db: invalid tenant id');
  return tenant_id;
}

export function selectTenant(db: AnyDb, tenant_id: string) {
  return db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenant(tenant_id)))
    .limit(1);
}

/** lookup_customer: the region is the called number's region (number A is IN). */
export function selectCustomerByNumberHash(db: AnyDb, tenant_id: string, region: string, numberHash: string) {
  return db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.tenant_id, tenant(tenant_id)),
        eq(customers.region, region),
        eq(customers.registered_number_hash, numberHash),
      ),
    )
    .limit(1);
}

export function selectCustomer(db: AnyDb, tenant_id: string, customer_id: string) {
  return db
    .select()
    .from(customers)
    .where(and(eq(customers.tenant_id, tenant(tenant_id)), eq(customers.id, customer_id)))
    .limit(1);
}

export function selectPolicyPack(db: AnyDb, tenant_id: string, region: string) {
  return db
    .select()
    .from(policyPacks)
    .where(and(eq(policyPacks.tenant_id, tenant(tenant_id)), eq(policyPacks.region, region)))
    .orderBy(sql`${policyPacks.version} desc`)
    .limit(1);
}

export function selectPass(db: AnyDb, tenant_id: string, pass_id: string) {
  return db
    .select()
    .from(passes)
    .where(and(eq(passes.tenant_id, tenant(tenant_id)), eq(passes.id, pass_id)))
    .limit(1);
}

/** Insert ledger entries in seq order. Re-inserting an already persisted seq is ignored (the outbox retries). */
export function insertLedgerEntries(db: AnyDb, tenant_id: string, entries: readonly LedgerEntry[]) {
  const t = tenant(tenant_id);
  if (entries.length === 0) throw new HalynError('E_FAIL_CLOSED', 'db: nothing to insert');
  const rows = [...entries]
    .sort((a, b) => a.seq - b.seq)
    .map((e) => {
      if (e.tenant_id !== t) throw new HalynError('E_FAIL_CLOSED', 'db: ledger entry from another tenant');
      return { ...e };
    });
  return db.insert(ledgerEntries).ignore().values(rows);
}

export function selectLedgerEntries(db: AnyDb, tenant_id: string, fromSeq = 1, limit = 1000) {
  return db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenant_id, tenant(tenant_id)), gte(ledgerEntries.seq, fromSeq)))
    .orderBy(asc(ledgerEntries.seq))
    .limit(limit);
}

/** A ledger row as read from TiDB, back in the exact shape the chain hashes. */
export function ledgerEntryFromRow(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
  const payload = typeof row.payload === 'string' ? (JSON.parse(row.payload) as unknown) : row.payload;
  return LedgerEntrySchema.parse({ ...row, payload });
}

export function upsertTenant(db: AnyDb, row: typeof tenants.$inferInsert) {
  return db
    .insert(tenants)
    .values({ ...row, id: tenant(row.id) })
    .onDuplicateKeyUpdate({
      set: { name: row.name, default_region: row.default_region, signing_key_id: row.signing_key_id },
    });
}

export function upsertCustomer(db: AnyDb, tenant_id: string, row: typeof customers.$inferInsert) {
  return db
    .insert(customers)
    .values({ ...row, tenant_id: tenant(tenant_id) })
    .onDuplicateKeyUpdate({
      set: {
        name: row.name,
        region: row.region,
        language: row.language,
        registered_number_hash: row.registered_number_hash,
        registered_number_last4: row.registered_number_last4,
      },
    });
}

export function upsertPolicyPack(db: AnyDb, tenant_id: string, row: typeof policyPacks.$inferInsert) {
  return db
    .insert(policyPacks)
    .values({ ...row, tenant_id: tenant(tenant_id) })
    .onDuplicateKeyUpdate({ set: { compiled_json: row.compiled_json, source_sha: row.source_sha } });
}

export function upsertPass(db: AnyDb, tenant_id: string, row: PassRow) {
  const t = tenant(tenant_id);
  if (row.tenant_id !== t) throw new HalynError('E_FAIL_CLOSED', 'db: Pass from another tenant');
  const values = {
    ...row,
    issued_at: new Date(row.issued_at),
    expires_at: new Date(row.expires_at),
    revoked_at: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
  return db
    .insert(passes)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        assistant_name: values.assistant_name,
        assistant_numbers: values.assistant_numbers,
        scopes: values.scopes,
        issued_at: values.issued_at,
        expires_at: values.expires_at,
        status: values.status,
        customer_sig: values.customer_sig,
        issuer_sig: values.issuer_sig,
        failures: values.failures,
        revoked_at: values.revoked_at,
      },
    });
}

/**
 * Integration-test clean-up only: deletes every row of a `ten_test_…` tenant. Refuses any other tenant, so it can
 * never touch real data.
 */
export function purgeTestTenant(db: AnyDb, tenant_id: string) {
  const t = tenant(tenant_id);
  if (!t.startsWith('ten_test_'))
    throw new HalynError('E_FAIL_CLOSED', 'db: only ten_test_ tenants can be purged');
  return Object.entries(TABLES).map(([name, table]) =>
    name === 'tenants'
      ? db.delete(tenants).where(eq(tenants.id, t))
      : db.delete(table).where(eq((table as typeof customers).tenant_id, t)),
  );
}
