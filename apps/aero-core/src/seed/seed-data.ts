import type { accounts, cards, fees, loans, payees, transactions } from '../db/schema';

// The demo bank's data (docs/DATA_MODEL.md "Seed"), deterministic: fixed ids, amounts and times. The same template
// seeds the demo customers (pnpm seed:core → seed/seed.sql) and every test's fresh customer, so tests exercise exactly
// what the scenarios run against. Ids that appear in action params (fee_late_oct, loan_personal_1, payee_mom,
// payee_landlord) are per customer; internal ids (accounts, cards, transactions) are derived from the customer id.

export const SEED_TENANT = 'ten_aero';

export type Region = 'IN' | 'US';

export interface SeedCustomer {
  tenant: string;
  /** Halyn's customer id, the grant's `sub`. */
  customer: string;
  region: Region;
}

/** The IN customer and the US twin from apps/api/src/db/seed-data.ts. */
export const DEMO_CUSTOMERS: readonly SeedCustomer[] = [
  { tenant: SEED_TENANT, customer: 'cus_saksham', region: 'IN' },
  { tenant: SEED_TENANT, customer: 'cus_saksham_us', region: 'US' },
];

export interface SeedRows {
  accounts: (typeof accounts.$inferInsert)[];
  cards: (typeof cards.$inferInsert)[];
  fees: (typeof fees.$inferInsert)[];
  loans: (typeof loans.$inferInsert)[];
  payees: (typeof payees.$inferInsert)[];
  transactions: (typeof transactions.$inferInsert)[];
}

/** Facts the scenarios (tests/scenarios/scenarios.yaml) and tests rely on. Amounts in minor units. */
export const SEED_FACTS = {
  IN: {
    account: 'savings',
    currency: 'INR',
    balance_minor: 52_000_000, // ₹5,20,000
    account_last4: '3094',
    card_last4: '8812', // scenario 1
    fee: { id: 'fee_late_oct', amount_minor: 60_000 }, // ₹600, scenario 2
    loan: { id: 'loan_personal_1', emi_minor: 1_250_000, emi_day: 5, outstanding_minor: 18_750_000 }, // scenario 5 moves it to the 10th
    payees: ['payee_mom', 'payee_landlord'], // scenarios 8 and 12
  },
  US: {
    account: 'checking',
    currency: 'USD',
    balance_minor: 1_245_000, // $12,450
    account_last4: '7731',
    card_last4: '2207',
    fee: { id: 'fee_us_late_oct', amount_minor: 3_500 }, // $35, the US pack's fee.waive limit
    loan: null,
    payees: ['payee_us_landlord'],
  },
} as const;

const OPENED_AT = '2021-04-01T04:30:00.000Z';

function body(customer: string): string {
  return customer.replace(/^cus_/, '');
}

/** One customer's rows from the region's template. */
export function customerRows({ tenant, customer, region }: SeedCustomer): SeedRows {
  const who = body(customer);
  const facts = SEED_FACTS[region];
  const account_id = `acc_${who}_${facts.account}`;
  const base = { tenant_id: tenant, customer_ref: customer };
  const money = { currency: facts.currency, account_id };
  let n = 0;
  const txn = (
    created_at: string,
    kind: 'credit' | 'debit',
    category: 'salary' | 'card' | 'fee' | 'emi' | 'transfer',
    amount_minor: number,
    description: string,
    extra: { payee_id?: string; fee_id?: string } = {},
  ) => ({
    ...base,
    ...money,
    id: `txn_${who}_${String((n += 1)).padStart(2, '0')}`,
    kind,
    category,
    amount_minor,
    description,
    payee_id: extra.payee_id ?? null,
    fee_id: extra.fee_id ?? null,
    reference: null,
    grant_jti: null,
    created_at,
  });

  const rows: SeedRows = {
    accounts: [
      {
        ...base,
        id: account_id,
        region,
        type: facts.account,
        currency: facts.currency,
        balance_minor: facts.balance_minor,
        last4: facts.account_last4,
        is_primary: true,
        status: 'active',
        opened_at: OPENED_AT,
      },
    ],
    cards: [
      {
        ...base,
        id: `card_${who}_debit`,
        account_id,
        last4: facts.card_last4,
        status: 'active',
        frozen_at: null,
        updated_by_grant: null,
      },
    ],
    fees: [
      {
        ...base,
        ...money,
        id: facts.fee.id,
        description: 'Late payment fee, October',
        amount_minor: facts.fee.amount_minor,
        status: 'due',
        charged_at: '2026-10-05T04:30:00.000Z',
        waived_at: null,
        waived_by_grant: null,
      },
    ],
    loans: [],
    payees: [],
    transactions: [],
  };

  if (region === 'IN') {
    const loan = SEED_FACTS.IN.loan;
    rows.loans.push({
      ...base,
      ...money,
      id: loan.id,
      description: 'Personal loan',
      emi_minor: loan.emi_minor,
      outstanding_minor: loan.outstanding_minor,
      emi_day: loan.emi_day,
      status: 'active',
      updated_at: OPENED_AT,
      updated_by_grant: null,
    });
    const payee = {
      ...base,
      saved: true,
      routing_last4: null,
      added_at: '2025-01-10T06:00:00.000Z',
      added_by_grant: null,
    };
    rows.payees.push(
      { ...payee, id: 'payee_mom', name: 'Mom', account_last4: '5521', ifsc: 'AERO0000003' },
      { ...payee, id: 'payee_landlord', name: 'Landlord', account_last4: '7734', ifsc: 'AERO0000004' },
    );
    rows.transactions.push(
      txn('2026-10-01T05:30:00.000Z', 'credit', 'salary', 9_500_000, 'Salary, October'),
      txn('2026-10-03T13:10:00.000Z', 'debit', 'card', 234_000, 'Groceries, card ending 8812'),
      txn('2026-10-05T04:30:00.000Z', 'debit', 'fee', 60_000, 'Late payment fee, October', {
        fee_id: 'fee_late_oct',
      }),
      txn('2026-10-05T04:31:00.000Z', 'debit', 'emi', 1_250_000, 'EMI, personal loan'),
      txn('2026-10-10T06:00:00.000Z', 'debit', 'transfer', 1_500_000, 'Rent, October', {
        payee_id: 'payee_landlord',
      }),
      txn('2026-10-18T12:00:00.000Z', 'debit', 'transfer', 500_000, 'Transfer to Mom', {
        payee_id: 'payee_mom',
      }),
      txn('2026-10-22T15:45:00.000Z', 'debit', 'card', 129_900, 'Online purchase, card ending 8812'),
    );
  } else {
    rows.payees.push({
      ...base,
      id: 'payee_us_landlord',
      name: 'Landlord',
      account_last4: '6610',
      ifsc: null,
      routing_last4: '0042',
      saved: true,
      added_at: '2025-01-10T15:00:00.000Z',
      added_by_grant: null,
    });
    rows.transactions.push(
      txn('2026-10-01T15:00:00.000Z', 'credit', 'salary', 650_000, 'Salary, October'),
      txn('2026-10-04T22:10:00.000Z', 'debit', 'card', 8_450, 'Groceries, card ending 2207'),
      txn('2026-10-05T15:00:00.000Z', 'debit', 'fee', 3_500, 'Late payment fee, October', {
        fee_id: 'fee_us_late_oct',
      }),
      txn('2026-10-10T15:00:00.000Z', 'debit', 'transfer', 180_000, 'Rent, October', {
        payee_id: 'payee_us_landlord',
      }),
    );
  }
  return rows;
}

/** All rows for several customers, table by table. */
export function seedRows(customers: readonly SeedCustomer[]): SeedRows {
  const all: SeedRows = { accounts: [], cards: [], fees: [], loans: [], payees: [], transactions: [] };
  for (const spec of customers) {
    const rows = customerRows(spec);
    all.accounts.push(...rows.accounts);
    all.cards.push(...rows.cards);
    all.fees.push(...rows.fees);
    all.loans.push(...rows.loans);
    all.payees.push(...rows.payees);
    all.transactions.push(...rows.transactions);
  }
  return all;
}
