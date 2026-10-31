import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { rows } from '../fixtures/env';
import { mintGrant } from '../fixtures/grants';
import { coreRequest, reply } from '../fixtures/http';

// Pitch deck slide 13: a judge's `cus_judge_…` account is created from the demo template on its first grant (a read
// included), so the agent's records — card 8812, the ₹600 late fee — fit the judge too. Other ids never get one.

const fetchCore = (request: Request) => reply(exports.default.fetch(request));

describe("a judge's demo account", () => {
  it('appears on the first grant, once, with the demo balance; the fee waiver works on it', async () => {
    const sub = `cus_judge_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const params = { account: 'savings' };
    const first = await mintGrant({ action: 'balance.view', params, sub });
    const balance = await fetchCore(coreRequest('balance.view', params, first.token));
    expect(balance.status).toBe(200);
    expect(JSON.stringify(balance.body)).toContain('52000000');
    const again = await mintGrant({ action: 'balance.view', params, sub });
    expect((await fetchCore(coreRequest('balance.view', params, again.token))).status).toBe(200);
    expect(await rows('SELECT id FROM accounts WHERE customer_ref = ?', sub)).toHaveLength(1);

    const fee = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
    const waive = await mintGrant({ action: 'fee.waive', params: fee, sub });
    expect((await fetchCore(coreRequest('fee.waive', fee, waive.token))).status).toBe(200);
  });

  it('any other unknown customer still has no account', async () => {
    const params = { account: 'savings' };
    const grant = await mintGrant({ action: 'balance.view', params, sub: 'cus_nobody_here' });
    expect((await fetchCore(coreRequest('balance.view', params, grant.token))).status).toBe(404);
  });
});
