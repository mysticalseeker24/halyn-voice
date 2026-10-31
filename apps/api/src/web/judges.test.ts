import { afterEach, describe, expect, it, vi } from 'vitest';
import { appHarness, REGISTERED } from '../../test/fixtures/app';

// Pitch deck slide 13: a judge signs up with the judge code, their name and their number, then calls Aero from that
// phone as a registered customer of their own (India + US twin). Their number is never called by Halyn.

afterEach(() => vi.restoreAllMocks());

const CODE = 'HALYN-JUDGE-TEST';
const JUDGE = '+919000000077';

async function harness() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const h = await appHarness();
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

  it('the judge code also signs in to the Stage and Console like the demo code', async () => {
    const h = await harness();
    const res = await h.fetch('/web/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-demo-code': CODE },
      body: JSON.stringify({ kind: 'console' }),
    });
    expect(res.status).toBe(200);
  });
});
