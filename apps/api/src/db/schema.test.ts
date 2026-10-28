import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { TABLES } from './schema';

const DOC_TABLES = [
  'tenants',
  'customers',
  'policy_packs',
  'passes',
  'pass_codes',
  'calls',
  'action_requests',
  'decisions',
  'grants',
  'confirmations',
  'handoffs',
  'ledger_entries',
  'test_runs',
  'test_results',
];

describe('TiDB schema', () => {
  it('has exactly the tables of docs/DATA_MODEL.md', () => {
    expect(
      Object.values(TABLES)
        .map((t) => getTableConfig(t).name)
        .sort(),
    ).toEqual([...DOC_TABLES].sort());
  });

  it.each(Object.entries(TABLES).filter(([name]) => name !== 'tenants'))(
    '%s carries tenant_id and leads its primary key with it (invariant 8)',
    (_, table) => {
      const config = getTableConfig(table);
      expect(config.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
      const pk = config.primaryKeys[0];
      expect(pk?.columns[0]?.name).toBe('tenant_id');
      for (const index of config.indexes)
        expect(index.config.columns[0]).toMatchObject({ name: 'tenant_id' });
    },
  );

  it('stores no full phone number anywhere', () => {
    for (const table of Object.values(TABLES))
      for (const column of getTableConfig(table).columns)
        expect(column.name).not.toMatch(/(^|_)(e164|phone|registered_number)$/);
  });

  it('keeps invariant 7 as a unique (tenant, run, params_hash) index (ADR-016)', () => {
    const index = getTableConfig(TABLES.action_requests).indexes.find(
      (i) => i.config.name === 'action_requests_idempotency',
    );
    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'tenant_id',
      'run_id',
      'params_hash',
    ]);
  });
});
