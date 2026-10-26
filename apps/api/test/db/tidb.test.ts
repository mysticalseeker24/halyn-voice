import { fixedClock, type LedgerEntry, verifyLedgerChain } from '@halyn/shared';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { registeredNumberHash } from '../../src/db/numbers';
import {
  insertLedgerEntries,
  ledgerEntryFromRow,
  purgeTestTenant,
  selectCustomer,
  selectCustomerByNumberHash,
  selectLedgerEntries,
  selectPass,
  upsertCustomer,
  upsertPass,
} from '../../src/db/queries';
import { hubFor } from '../../src/hub/client';
import type { HubDO } from '../../src/hub/hub-do';
import { tidbLedgerSink } from '../../src/hub/ledger-sink';
import { nextLedgerEntry } from '../../src/ledger';
import { TEST_PASS_ROW } from '../fixtures/db';

// The gated DB suite (ADR-013): real TiDB, database halyn_test, migrated by scripts/test-db-setup.ts. Each run uses
// its own `ten_test_…` tenants and deletes their rows afterwards. Skips (with a warning) when no credentials exist.

const url = (env as unknown as { TIDB_TEST_DATABASE_URL?: string }).TIDB_TEST_DATABASE_URL ?? '';
const run = Date.now().toString(36);
const A = `ten_test_${run}a`;
const B = `ten_test_${run}b`;
const PEPPER = 'p'.repeat(32);

if (!url) console.warn('⚠ DB suite SKIPPED: TIDB_TEST_DATABASE_URL is not set (ADR-013).');

describe.skipIf(!url)('TiDB (halyn_test)', () => {
  const db = createDb(url);

  afterAll(async () => {
    for (const tenant of [A, B]) for (const statement of purgeTestTenant(db, tenant)) await statement;
  });

  it('has every table from the migrations', async () => {
    const rows = (await db.$client.execute(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'halyn_test' AND table_name IN ('tenants','customers','policy_packs','passes','pass_codes','calls','action_requests','decisions','grants','confirmations','handoffs','ledger_entries','test_runs','test_results')",
    )) as { n: number | string }[];
    expect(Number(rows[0]?.n)).toBe(14);
  });

  it('reads customers through the tenant helpers and never across tenants (invariant 8)', async () => {
    const hash = await registeredNumberHash(PEPPER, '+919000000003');
    const customer = {
      id: 'cus_saksham',
      tenant_id: A,
      name: 'Saksham Mishra',
      region: 'IN',
      language: 'hi',
      registered_number_hash: hash,
      registered_number_last4: '0003',
      created_at: new Date('2026-10-25T00:00:00.000Z'),
    };
    await upsertCustomer(db, A, customer);
    await upsertCustomer(db, A, { ...customer, name: 'Saksham M' }); // upsert, not a duplicate
    expect((await selectCustomer(db, A, 'cus_saksham')).map((c) => c.name)).toEqual(['Saksham M']);
    expect((await selectCustomerByNumberHash(db, A, 'IN', hash)).map((c) => c.id)).toEqual(['cus_saksham']);
    expect(await selectCustomerByNumberHash(db, A, 'US', hash)).toEqual([]);
    expect(await selectCustomer(db, B, 'cus_saksham')).toEqual([]);
    expect(await selectCustomerByNumberHash(db, B, 'IN', hash)).toEqual([]);
  });

  it('round-trips a Pass row', async () => {
    await upsertPass(db, A, { ...TEST_PASS_ROW, tenant_id: A });
    const [row] = await selectPass(db, A, 'pass_demo');
    expect(row?.scopes).toEqual(TEST_PASS_ROW.scopes);
    expect(row?.expires_at.toISOString()).toBe(TEST_PASS_ROW.expires_at);
    expect(await selectPass(db, B, 'pass_demo')).toEqual([]);
  });

  it('stores ledger entries in seq order, ignores re-sends, and the chain still verifies from TiDB', async () => {
    const entries: LedgerEntry[] = [];
    let head: { seq: number; hash: string } | null = null;
    for (let i = 1; i <= 6; i += 1) {
      const entry = await nextLedgerEntry(
        head,
        {
          tenant_id: A,
          type: 'proposed',
          ref_id: `req_${i}`,
          payload: { i, amount: { amount_minor: 4500000, currency: 'INR' }, note: 'caller +918065356344' },
        },
        fixedClock(Date.UTC(2026, 9, 26, 10, 0, i)),
      );
      entries.push(entry);
      head = { seq: entry.seq, hash: entry.hash };
    }
    await insertLedgerEntries(db, A, entries.slice(3).reverse()); // out of order in, seq order out
    await insertLedgerEntries(db, A, entries.slice(0, 4)); // seq 4 is a re-send: ignored
    const stored = (await selectLedgerEntries(db, A)).map(ledgerEntryFromRow);
    expect(stored.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stored).toEqual(entries);
    expect(await verifyLedgerChain(stored, { anchor: head ?? undefined })).toMatchObject({
      ok: true,
      entries: 6,
    });
    expect(await selectLedgerEntries(db, B)).toEqual([]);
  });

  it("the Hub's outbox lands in TiDB through the real sink, in seq order", async () => {
    const raw = env.HUB.getByName(B);
    await runInDurableObject(raw, (instance: HubDO) => {
      instance.sink = tidbLedgerSink({ TIDB_DATABASE_URL: url });
    });
    const hub = hubFor(env, B);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        hub.appendLedger({ type: 'decided', ref_id: `req_${i}`, payload: { i } }),
      ),
    );
    await runDurableObjectAlarm(raw);
    const stored = (await selectLedgerEntries(db, B)).map(ledgerEntryFromRow);
    expect(stored.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stored).toEqual(await hub.ledgerEntries());
    expect(await verifyLedgerChain(stored, { anchor: (await hub.ledgerHead()) ?? undefined })).toMatchObject({
      ok: true,
    });
  });
});
