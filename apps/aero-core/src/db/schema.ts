import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Aero Core's D1 (SQLite) database: the mock bank, physically separate from Halyn (docs/DATA_MODEL.md).
// Every table carries tenant_id and every query filters on it (invariant 8). Rows belong to a customer (`customer_ref`
// = the grant's `sub`); ids that appear in action params (fee_id, loan_id, payee_id) are unique per customer, so those
// tables key on (tenant_id, customer_ref, id). Money is INTEGER minor units + currency (invariant 9). Times are UTC
// ISO-8601 strings. Migrations: `pnpm --filter @halyn/aero-core db:generate` → migrations/ (committed).
// CHECK constraints are written as plain SQL so SQLite never sees table-qualified names.

export const CURRENCIES = ['INR', 'USD'] as const;
export const ACCOUNT_TYPES = ['savings', 'current', 'checking'] as const;

const tenantId = () => text('tenant_id').notNull();
const customerRef = () => text('customer_ref').notNull();
const currency = () => text('currency', { enum: CURRENCIES }).notNull();
const currencyCheck = (table: string) => check(`${table}_currency`, sql`currency IN ('INR', 'USD')`);

export const accounts = sqliteTable(
  'accounts',
  {
    tenant_id: tenantId(),
    id: text('id').notNull(),
    customer_ref: customerRef(),
    region: text('region', { enum: ['IN', 'US'] }).notNull(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    currency: currency(),
    balance_minor: integer('balance_minor').notNull(),
    /** The account number's last 4 digits: the only part of it Aero Core stores. */
    last4: text('last4').notNull().default('0000'),
    /** Transfers debit the customer's primary account in the transfer's currency. */
    is_primary: integer('is_primary', { mode: 'boolean' }).notNull(),
    status: text('status', { enum: ['active', 'blocked'] }).notNull(),
    opened_at: text('opened_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    uniqueIndex('accounts_customer_type').on(t.tenant_id, t.customer_ref, t.type),
    uniqueIndex('accounts_customer_primary')
      .on(t.tenant_id, t.customer_ref, t.currency)
      .where(sql`is_primary = 1`),
    // The atomic backstop for "balances never go negative": a debit that would overdraw aborts its whole batch.
    check('accounts_balance_non_negative', sql`balance_minor >= 0`),
    check('accounts_status', sql`status IN ('active', 'blocked')`),
    currencyCheck('accounts'),
  ],
);

export const cards = sqliteTable(
  'cards',
  {
    tenant_id: tenantId(),
    id: text('id').notNull(),
    customer_ref: customerRef(),
    account_id: text('account_id').notNull(),
    last4: text('last4').notNull(),
    status: text('status', { enum: ['active', 'frozen'] }).notNull(),
    frozen_at: text('frozen_at'),
    updated_by_grant: text('updated_by_grant'),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    // A customer's cards are told apart by their last 4 digits (what a caller can say).
    uniqueIndex('cards_customer_last4').on(t.tenant_id, t.customer_ref, t.last4),
    check('cards_status', sql`status IN ('active', 'frozen')`),
    check('cards_last4', sql`length(last4) = 4`),
  ],
);

export const fees = sqliteTable(
  'fees',
  {
    tenant_id: tenantId(),
    customer_ref: customerRef(),
    id: text('id').notNull(),
    account_id: text('account_id').notNull(),
    description: text('description').notNull(),
    amount_minor: integer('amount_minor').notNull(),
    currency: currency(),
    status: text('status', { enum: ['due', 'waived'] }).notNull(),
    charged_at: text('charged_at').notNull(),
    waived_at: text('waived_at'),
    waived_by_grant: text('waived_by_grant'),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.customer_ref, t.id] }),
    check('fees_amount_positive', sql`amount_minor > 0`),
    check('fees_status', sql`status IN ('due', 'waived')`),
    currencyCheck('fees'),
  ],
);

export const loans = sqliteTable(
  'loans',
  {
    tenant_id: tenantId(),
    customer_ref: customerRef(),
    id: text('id').notNull(),
    account_id: text('account_id').notNull(),
    description: text('description').notNull(),
    emi_minor: integer('emi_minor').notNull(),
    /** What is still owed, in minor units. */
    outstanding_minor: integer('outstanding_minor').notNull().default(0),
    currency: currency(),
    emi_day: integer('emi_day').notNull(),
    status: text('status', { enum: ['active', 'closed'] }).notNull(),
    updated_at: text('updated_at').notNull(),
    updated_by_grant: text('updated_by_grant'),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.customer_ref, t.id] }),
    check('loans_emi_positive', sql`emi_minor > 0`),
    check('loans_emi_day', sql`emi_day BETWEEN 1 AND 28`),
    check('loans_status', sql`status IN ('active', 'closed')`),
    currencyCheck('loans'),
  ],
);

export const payees = sqliteTable(
  'payees',
  {
    tenant_id: tenantId(),
    customer_ref: customerRef(),
    id: text('id').notNull(),
    name: text('name'),
    account_last4: text('account_last4').notNull(),
    /** India: the branch IFSC. */
    ifsc: text('ifsc'),
    /** US: the last 4 digits of the routing number. */
    routing_last4: text('routing_last4'),
    /** Saved payees can be paid with `transfer.saved`; new payees are added unsaved by the transfer that pays them. */
    saved: integer('saved', { mode: 'boolean' }).notNull(),
    added_at: text('added_at').notNull(),
    added_by_grant: text('added_by_grant'),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.customer_ref, t.id] }),
    check('payees_account_last4', sql`length(account_last4) = 4`),
  ],
);

export const transactions = sqliteTable(
  'transactions',
  {
    tenant_id: tenantId(),
    id: text('id').notNull(),
    customer_ref: customerRef(),
    account_id: text('account_id').notNull(),
    kind: text('kind', { enum: ['credit', 'debit'] }).notNull(),
    category: text('category', {
      enum: ['salary', 'card', 'fee', 'fee_waiver', 'emi', 'transfer', 'wire'],
    }).notNull(),
    amount_minor: integer('amount_minor').notNull(),
    currency: currency(),
    description: text('description').notNull(),
    payee_id: text('payee_id'),
    /** The fee a `fee` charge or `fee_waiver` credit belongs to. */
    fee_id: text('fee_id'),
    reference: text('reference'),
    /** The Halyn grant that caused this row (null for seeded history). */
    grant_jti: text('grant_jti'),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    index('transactions_account_time').on(t.tenant_id, t.account_id, t.created_at),
    // A fee is credited back at most once, even if two different grants race for it.
    uniqueIndex('transactions_fee_waived_once')
      .on(t.tenant_id, t.customer_ref, t.fee_id)
      .where(sql`category = 'fee_waiver'`),
    check('transactions_amount_positive', sql`amount_minor > 0`),
    check('transactions_kind', sql`kind IN ('credit', 'debit')`),
    currencyCheck('transactions'),
  ],
);

/**
 * Every grant Aero Core has executed (invariant 1: a jti is used once). The row is inserted in the same D1 batch as
 * the write it authorises, so a replay aborts atomically on the primary key.
 */
export const usedGrants = sqliteTable(
  'used_grants',
  {
    jti: text('jti').primaryKey(),
    tenant_id: tenantId(),
    customer_ref: customerRef(),
    action: text('action').notNull(),
    request_id: text('request_id').notNull(),
    used_at: text('used_at').notNull(),
  },
  (t) => [index('used_grants_customer').on(t.tenant_id, t.customer_ref, t.used_at)],
);

export const TABLES = {
  accounts,
  cards,
  fees,
  loans,
  payees,
  transactions,
  used_grants: usedGrants,
} as const;
