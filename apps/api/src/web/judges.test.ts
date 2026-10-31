import { afterEach, describe, expect, it, vi } from 'vitest';
import { appHarness, REGISTERED } from '../../test/fixtures/app';

// Pitch deck slide 13: a judge signs up with the judge code, their name and their number, then calls Aero from that
// phone as a registered customer of their own (India + US twin). Their number is never called by Halyn.

afterEach(() => vi.restoreAllMocks());

const CODE = 'HALYN-JUDGE-TEST';
const JUDGE = '+919000000077';

async function harness(start?: number) {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const h = await appHarness(start === undefined ? {} : { start });
  Object.assign(h.env, { JUDGE_ACCESS_CODE: CODE });
  return h;
}

describe('POST /web/judges/signup', () => {
  it('a judge becomes a registered customer of their own, and the same number signs in again', async () => {
    const h = await harness();
    expect(
      (await h.web('/web/judges/signup', { code: 'wrong-code', name: 'Asha Rao', phone: JUDGE })).status,
    ).toBe(401);
    expect((await h.web('/web/judges/signup', { code: CODE, name: 'A', phone: '12345' })).status).toBe(400);

    const res = await h.web('/web/judges/signup', { code: CODE, name: 'Asha Rao', phone: JUDGE });
    expect(res.status).toBe(200);
    const session = (await res.json()) as { kind: string; customer_id: string; token: string };
    expect(session).toMatchObject({ kind: 'customer', customer_id: expect.stringMatching(/^cus_judge_/) });
    // Only the hash and the last 4 digits reach TiDB (through the outbox).
    await h.fireAlarm();
    const rows = h.mirror.items.filter((i) => i.kind === 'customer').map((i) => i.row);
    expect(rows.map((r) => r.region)).toEqual(['IN', 'US']);
    expect(JSON.stringify(rows)).not.toContain(JUDGE);

    const lookup = await h.tool('lookup_customer', {
      run_id: '0b5c7a4e-1111-4222-8333-777777777777',
      from_number: JUDGE,
    });
    expect(await lookup.json()).toMatchObject({
      customer_found: true,
      customer_name: 'Asha Rao',
      registered: true,
    });

    const again = await h.web('/web/judges/signup', { code: CODE, name: 'Asha Rao', phone: JUDGE });
    expect(((await again.json()) as { customer_id: string }).customer_id).toBe(session.customer_id);
    // The demo customer's own number cannot be taken over.
    expect(
      (await h.web('/web/judges/signup', { code: CODE, name: 'Someone', phone: REGISTERED })).status,
    ).toBe(400);
  });

  it('at 00:30 IST a judge gets the daytime decision; the demo customer still gets S_UNUSUAL_HOUR', async () => {
    const night = Date.UTC(2026, 10, 2, 19, 0, 0); // 00:30 IST
    const h = await harness(night);
    await h.web('/web/judges/signup', { code: CODE, name: 'Asha Rao', phone: JUDGE });
    const waive = async (run_id: string, from_number: string) => {
      await h.tool('lookup_customer', { run_id, from_number });
      const res = await h.tool('propose_action', {
        run_id,
        channel: 'phone',
        action: 'fee.waive',
        params: { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' },
        readback_confirmed: true,
        caller_quotes: 'Please waive my late fee',
      });
      const { request_id } = (await res.json()) as { request_id: string };
      return (await h.hub.requestState(request_id))?.decision;
    };
    const judge = await waive('0b5c7a4e-1111-4222-8333-999999999991', JUDGE);
    expect(judge).toMatchObject({ outcome: 'allow' });
    expect(judge?.reasons).not.toContain('S_UNUSUAL_HOUR');
    const demo = await waive('0b5c7a4e-1111-4222-8333-999999999992', REGISTERED);
    expect(demo?.reasons).toContain('S_UNUSUAL_HOUR');
  });

  it("Aero's own numbers (A, B) cannot be registered by a judge", async () => {
    const h = await harness();
    const numbers = h.env as unknown as { NUMBER_A: string; NUMBER_B: string };
    for (const phone of [numbers.NUMBER_A, numbers.NUMBER_B]) {
      const res = await h.web('/web/judges/signup', { code: CODE, name: 'Someone', phone });
      expect(res.status).toBe(400);
    }
  });

  it('the judge code also signs in to the Stage and Console like the demo code', async () => {
    const h = await harness();
    const res = await h.fetch('/web/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-demo-code': CODE },
      body: JSON.stringify({ kind: 'console' }),
    });
    expect(res.status).toBe(200);
  });

  it("an approval sheet reaches only its own customer's Aero app, never another judge's", async () => {
    const h = await harness();
    const signup = await h.web('/web/judges/signup', { code: CODE, name: 'Asha Rao', phone: JUDGE });
    const judge = ((await signup.json()) as { customer_id: string }).customer_id;
    const demoApp = await h.listen('aero');
    const judgeApp = await h.listen('aero', judge);
    const stage = await h.listen('stage');

    // The demo customer asks for a new payee from the registered number: tier 3 → step-up to their own app.
    const run_id = '0b5c7a4e-1111-4222-8333-888888888888';
    await h.tool('lookup_customer', { run_id, from_number: REGISTERED });
    await h.tool('propose_action', {
      run_id,
      channel: 'phone',
      action: 'transfer.new_payee',
      params: {
        amount_minor: 4500000,
        currency: 'INR',
        payee_account_last4: '4471',
        payee_ifsc: 'AERO0000001',
      },
      readback_confirmed: true,
      caller_quotes: 'Send it to the new account',
    });
    await h.settle();
    await new Promise((resolve) => setTimeout(resolve, 20)); // socket messages arrive a tick later
    const sheets = (messages: { type: string }[]) => messages.filter((m) => m.type === 'confirm_request');
    expect(sheets(demoApp)).toHaveLength(1);
    expect(sheets(stage)).toHaveLength(1);
    expect(sheets(judgeApp)).toHaveLength(0);
    expect(judgeApp.some((m) => 'request_id' in m)).toBe(false);
  });
});
