import { seedStatements } from './seed-sql';

// A judge's demo account (pitch deck slide 13, POST /web/judges/signup on Halyn): Halyn names them `cus_judge_<id>`
// (India) and `cus_judge_<id>_us` (the US twin). The first grant for such an id creates its rows from the same
// template as the demo customer's — the card ending 8812, the ₹600 late fee, the saved payees — so the Aero agent's
// records fit every judge. Demo-only: a real core system would never open an account on a request.

const JUDGE_ID = /^cus_judge_[A-Za-z0-9]+(_us)?$/;

const exists = (d1: D1Database, tenant: string, customer: string) =>
  d1
    .prepare('SELECT 1 AS found FROM accounts WHERE tenant_id = ? AND customer_ref = ? LIMIT 1')
    .bind(tenant, customer)
    .first();

export async function ensureJudgeAccount(d1: D1Database, tenant: string, customer: string): Promise<void> {
  if (!JUDGE_ID.test(customer) || (await exists(d1, tenant, customer))) return;
  const region = customer.endsWith('_us') ? 'US' : 'IN';
  const inserts = seedStatements([{ tenant, customer, region }]).filter((s) => s.startsWith('INSERT'));
  try {
    await d1.batch(inserts.map((s) => d1.prepare(s)));
  } catch (err) {
    // Two first requests raced and the other one created the rows: nothing to do.
    if (!(await exists(d1, tenant, customer))) throw err;
  }
}
