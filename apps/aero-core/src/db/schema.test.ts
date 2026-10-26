import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, testEnv } from '../../test/fixtures/env';
import { TABLES } from './schema';

// The D1 schema (docs/DATA_MODEL.md "D1") against the committed migrations, as applied to Miniflare's D1.

const DOC_TABLES = ['accounts', 'cards', 'fees', 'loans', 'payees', 'transactions', 'used_grants'];

describe('Aero Core D1 schema', () => {
  it('has exactly the tables of docs/DATA_MODEL.md', () => {
    expect(
      Object.values(TABLES)
        .map((t) => getTableConfig(t).name)
        .sort(),
    ).toEqual([...DOC_TABLES].sort());
  });

  it.each(Object.entries(TABLES))(
    '%s: the migration creates exactly the schema’s columns',
    async (name, table) => {
      const columns = await rows<{ name: string; notnull: number }>(
        `SELECT name, "notnull" FROM pragma_table_info('${name}')`,
      );
      expect(columns.map((c) => c.name).sort()).toEqual(
        getTableConfig(table)
          .columns.map((c) => c.name)
          .sort(),
      );
    },
  );

  it.each(Object.entries(TABLES))('%s carries a NOT NULL tenant_id (invariant 8)', (_, table) => {
    expect(getTableConfig(table).columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
  });

  it.each(Object.entries(TABLES).filter(([name]) => name !== 'used_grants'))(
    '%s leads its primary key with tenant_id',
    (_, table) => {
      expect(getTableConfig(table).primaryKeys[0]?.columns[0]?.name).toBe('tenant_id');
    },
  );

  it('used_grants is keyed by the jti alone (a jti is used once, anywhere)', () => {
    expect(getTableConfig(TABLES.used_grants).columns.find((c) => c.name === 'jti')?.primary).toBe(true);
  });

  it('money columns are INTEGER minor units next to a currency (invariant 9)', () => {
    for (const table of Object.values(TABLES)) {
      const config = getTableConfig(table);
      for (const column of config.columns.filter((c) => c.name.endsWith('_minor'))) {
        expect(column.getSQLType(), `${config.name}.${column.name}`).toBe('integer');
        expect(
          config.columns.some((c) => c.name === 'currency'),
          config.name,
        ).toBe(true);
      }
    }
  });

  it('stores no full phone, card or account number column', () => {
    for (const table of Object.values(TABLES))
      for (const column of getTableConfig(table).columns)
        expect(column.name).not.toMatch(/(^|_)(e164|phone|number|pan|card_number|account_number)$/);
  });

  it('the database itself refuses a negative balance, an unknown currency, a zero fee and an EMI on the 29th', async () => {
    const sub = await seedCustomer();
    const db = testEnv().DB;
    await expect(
      db.prepare('UPDATE accounts SET balance_minor = -1 WHERE customer_ref = ?').bind(sub).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      db.prepare("UPDATE accounts SET currency = 'EUR' WHERE customer_ref = ?").bind(sub).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      db.prepare('UPDATE fees SET amount_minor = 0 WHERE customer_ref = ?').bind(sub).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      db.prepare('UPDATE loans SET emi_day = 29 WHERE customer_ref = ?').bind(sub).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
