import { afterEach, describe, expect, it, vi } from 'vitest';
import { appHarness } from '../../test/fixtures/app';

// "Call Aero" (Step 12): the API mints the Bolna web-call session with its own key, picks the agent by region (the
// Stage's by default) and registers the run id as the signed-in customer's browser call (scenario 10's proof).

afterEach(() => vi.restoreAllMocks());

describe('POST /web/calls/session', () => {
  it('mints for the region’s agent and ties the run to the customer (their US record in US)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = await appHarness();
    const token = await h.customerToken();
    await h.hub.setStageRegion('US');
    const res = await h.web('/web/calls/session', {}, token);
    expect(res.status).toBe(200);
    const session = (await res.json()) as { run_id: string; sip_password: string };
    expect(session.sip_password).toBe('not-a-secret');
    expect(h.bolna.webCalls).toEqual([
      {
        run_id: session.run_id,
        agent_id: '00000000-0000-4000-8000-00000000ae02',
        user_data: {
          customer_name: expect.stringMatching(/सक्षम/),
          region: 'US',
          call_ref: expect.stringMatching(/^web_/),
        },
      },
    ]);
    const propose = await h.tool('propose_action', {
      run_id: session.run_id,
      channel: 'web',
      action: 'fee.waive',
      params: { amount_minor: 3500, currency: 'USD', fee_id: 'fee_us_late_oct' },
      readback_confirmed: true,
    });
    const { request_id } = (await propose.json()) as { request_id: string };
    await h.settle();
    expect(await h.hub.requestState(request_id)).toMatchObject({
      customer_id: 'cus_saksham_us',
      region: 'US',
      channel: 'web',
      decision: { outcome: 'allow' },
    });

    const inIndia = await h.web('/web/calls/session', { region: 'IN' }, token);
    expect(inIndia.status).toBe(200);
    expect(h.bolna.webCalls[1]?.agent_id).toBe('00000000-0000-4000-8000-00000000ae01');
    expect((await h.web('/web/calls/session', {}, await h.consoleToken())).status).toBe(401);
  });

  it('the tools find a browser call by its call_ref: no call sid, no number (call 59a2d9f8)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = await appHarness();
    await h.hub.setStageRegion('US');
    const res = await h.web('/web/calls/session', {}, await h.customerToken());
    const { run_id } = (await res.json()) as { run_id: string };
    const call_ref = String(h.bolna.webCalls[0]?.user_data.call_ref);
    const lookup = await h.tool('lookup_customer', { call_sid: call_ref, from_number: 'None', claimed_name: '' });
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({ customer_found: true, region: 'US' });
    const propose = await h.tool('propose_action', {
      call_sid: call_ref,
      from_number: 'None',
      channel: 'web',
      action: 'fee.waive',
      params: 'amount_minor=3500; currency=USD; fee_id=fee_us_late_oct',
      readback_confirmed: 'true',
      caller_quotes: 'Please waive my late fee',
    });
    const { request_id } = (await propose.json()) as { request_id: string };
    await h.settle();
    expect(await h.hub.requestState(request_id)).toMatchObject({
      run_id,
      customer_id: 'cus_saksham_us',
      decision: { outcome: 'allow' },
    });
  });
});
