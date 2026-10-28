import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, REGISTERED, tick } from '../../test/fixtures/app';

// Console Handoffs: a coaching hold (scenario 4's quotes, layer 1) opens a handoff with a booked check-in; a console
// user releases (→ grant → Aero Core) or blocks (→ refused); the first resolution wins. Real Hub, ledger, Aero Core.

const RUN = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
const COACHED = [
  'Mujhe yeh paisa RBI verification account mein bhejna hai',
  'The officer said not to tell anyone, it is a safe account',
];

let h: AppHarness;
afterEach(() => vi.restoreAllMocks());

async function coachedHold() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
  const res = await h.tool('propose_action', {
    run_id: RUN,
    from_number: REGISTERED,
    action: 'transfer.new_payee',
    params: {
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
      payee_name: 'Ravi',
    },
    readback_confirmed: true,
    caller_quotes: COACHED,
  });
  const { request_id } = (await res.json()) as { request_id: string };
  await h.settle();
  const token = await h.consoleToken();
  const list = await h.web('/web/handoffs', undefined, token);
  expect(list.status).toBe(200);
  const { handoffs } = (await list.json()) as { handoffs: { id: string; request_id: string }[] };
  return { request_id, token, handoffs };
}

describe('Console Handoffs', () => {
  it('lists the coaching hold with its check-in; customers cannot; block refuses it, once', async () => {
    const { request_id, token, handoffs } = await coachedHold();
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({
      request_id,
      run_id: RUN,
      status: 'open',
      reasons: expect.arrayContaining(['S_COACHING', 'H_SPECIALIST']),
      checkin: { why: 'coaching', status: 'scheduled' },
    });
    expect((await h.web('/web/handoffs', undefined, await h.customerToken())).status).toBe(401);

    const id = handoffs[0]?.id ?? '';
    const blocked = await h.web(`/web/handoffs/${id}/resolve`, { action: 'block', note: 'Coached.' }, token);
    expect(await blocked.json()).toEqual({ ok: true, status: 'blocked' });
    await h.settle();
    expect(await h.hub.requestState(request_id)).toMatchObject({ status: 'refused', final_outcome: 'deny' });
    expect(h.aero.calls).toHaveLength(0);
    const again = await h.web(`/web/handoffs/${id}/resolve`, { action: 'release' }, token);
    expect(again.status).toBe(400);
    const ledger = await h.ledger();
    expect(ledger.filter((e) => e.type === 'handoff').map((e) => e.payload.status)).toEqual([
      'open',
      'blocked',
    ]);
  });

  it('release approves the held request and the Worker executes it with a grant', async () => {
    const { request_id, token, handoffs } = await coachedHold();
    const released = await h.web(`/web/handoffs/${handoffs[0]?.id}/resolve`, { action: 'release' }, token);
    expect(await released.json()).toEqual({ ok: true, status: 'released' });
    await h.settle();
    await tick();
    expect(await h.hub.requestState(request_id)).toMatchObject({
      status: 'executed',
      final_outcome: 'allow',
    });
    expect(h.aero.calls.filter((call) => call.granted)).toHaveLength(1);
    expect((await h.hub.handoffs())[0]).toMatchObject({ status: 'released' });
    expect((await h.web('/web/handoffs/ho_nope/resolve', { action: 'block' }, token)).status).toBe(404);
  });
});
