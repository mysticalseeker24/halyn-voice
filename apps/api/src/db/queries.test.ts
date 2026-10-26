import { GENESIS_HASH, HalynError, type LedgerEntry } from '@halyn/shared';
import { drizzle } from 'drizzle-orm/tidb-serverless';
import { describe, expect, it } from 'vitest';
import { TEST_PASS_ROW } from '../../test/fixtures/db';
import {
  insertLedgerEntries,
  ledgerEntryFromRow,
  purgeTestTenant,
  selectCustomer,
  selectCustomerByNumberHash,
  selectLedgerEntries,
  selectPass,
  selectPolicyPack,
  selectTenant,
  upsertCustomer,
  upsertPass,
  upsertPolicyPack,
  upsertTenant,
} from './queries';
import * as schema from './schema';

// Offline: Drizzle's mock database turns each helper into SQL without a connection, so we can check every query is
// tenant-scoped (invariant 8).
const db = drizzle.mock({ schema });
const T = 'ten_aero';
const H = 'a'.repeat(64);
const at = new Date('2026-10-26T00:00:00.000Z');

function entry(seq: number, tenant_id = T): LedgerEntry {
  return {
    seq,
    tenant_id,
    type: 'proposed',
    ref_id: `req_${seq}`,
    payload: { n: seq },
    prev_hash: GENESIS_HASH,
    hash: H,
    created_at: at.toISOString(),
  };
}

describe('tenant-scoped queries', () => {
  it.each([
    ['selectCustomerByNumberHash', () => selectCustomerByNumberHash(db, T, 'IN', H).toSQL()],
    ['selectCustomer', () => selectCustomer(db, T, 'cus_saksham').toSQL()],
    ['selectPolicyPack', () => selectPolicyPack(db, T, 'IN').toSQL()],
    ['selectPass', () => selectPass(db, T, 'pass_demo').toSQL()],
    ['selectLedgerEntries', () => selectLedgerEntries(db, T, 5, 10).toSQL()],
  ])('%s filters on tenant_id', (_, build) => {
    const { sql, params } = build();
    expect(sql).toMatch(/where .*`tenant_id` = \?/i);
    expect(params).toContain(T);
  });

  it('selectTenant addresses the tenant row itself', () => {
    const { sql, params } = selectTenant(db, T).toSQL();
    expect(sql).toMatch(/`tenants`\.`id` = \?/);
    expect(params).toContain(T);
  });

  it('refuses a malformed tenant id before building any SQL', () => {
    for (const bad of ['', 'aero', 'TEN_aero', "ten_x' OR '1'='1"])
      expect(() => selectCustomer(db, bad, 'cus_saksham')).toThrow(HalynError);
  });

  it('inserts ledger entries in seq order, ignoring re-sends, and refuses other tenants', () => {
    const { sql, params } = insertLedgerEntries(db, T, [entry(2), entry(1)]).toSQL();
    expect(sql).toMatch(/^insert ignore into `ledger_entries`/i);
    expect(params.indexOf(1)).toBeLessThan(params.indexOf(2));
    expect(() => insertLedgerEntries(db, T, [entry(1, 'ten_other')])).toThrow(HalynError);
    expect(() => insertLedgerEntries(db, T, [])).toThrow(HalynError);
  });

  it('reads a ledger row back into the exact hashed shape, JSON payload or string', () => {
    const row = { ...entry(1), payload: JSON.stringify({ n: 1 }) };
    expect(ledgerEntryFromRow(row)).toEqual(entry(1));
    expect(ledgerEntryFromRow(entry(1))).toEqual(entry(1));
  });

  it('upserts seed rows with the tenant forced from the argument', () => {
    expect(
      upsertTenant(db, {
        id: T,
        name: 'Aero',
        default_region: 'IN',
        signing_key_id: 'k',
        created_at: at,
      }).toSQL().sql,
    ).toMatch(/on duplicate key update/i);
    const customer = upsertCustomer(db, T, {
      id: 'cus_saksham',
      tenant_id: 'ten_other',
      name: 'S',
      region: 'IN',
      language: 'hi',
      registered_number_hash: H,
      registered_number_last4: '0003',
      created_at: at,
    }).toSQL();
    expect(customer.params).toContain(T);
    expect(customer.params).not.toContain('ten_other');
    const pack = upsertPolicyPack(db, T, {
      id: 'aero-in-v1',
      tenant_id: T,
      region: 'IN',
      version: 1,
      compiled_json: {},
      source_sha: H,
      created_at: at,
    }).toSQL();
    expect(pack.sql).toMatch(/on duplicate key update/i);
    expect(upsertPass(db, T, TEST_PASS_ROW).toSQL().params).toContain('pass_demo');
    expect(upsertPass(db, T, { ...TEST_PASS_ROW, revoked_at: at.toISOString() }).toSQL().sql).toMatch(
      /insert into `passes`/,
    );
    expect(() => upsertPass(db, T, { ...TEST_PASS_ROW, tenant_id: 'ten_other' })).toThrow(HalynError);
  });

  it('purges only ten_test_ tenants, across every table', () => {
    const statements = purgeTestTenant(db, 'ten_test_x1');
    expect(statements).toHaveLength(Object.keys(schema.TABLES).length);
    for (const s of statements) expect(s.toSQL().params).toEqual(['ten_test_x1']);
    expect(() => purgeTestTenant(db, T)).toThrow(HalynError);
  });
});
