import {
  AeroHomeSchema,
  ErrorEnvelopeSchema,
  LedgerListResponseSchema,
  LedgerVerifyResponseSchema,
  StageRunResponseSchema,
  type WsMessage,
} from '@halyn/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AppHarness,
  appHarness,
  REGISTERED,
  tick,
  UNREGISTERED,
  WEB_ORIGIN,
} from '../../test/fixtures/app';
import { softPasskey } from '../../test/fixtures/webauthn';

// The Aero app and Stage routes Step 9 consumes, through the real app, Hub and Aero Core.

const RUN = '7d1e0c2a-2222-4333-8444-555566667777';
let h: AppHarness;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

const code = async (res: Response) => ErrorEnvelopeSchema.parse(await res.json()).error.code;

/** A new-payee transfer from another phone: step-up with passkey + callback. */
async function stepUp(amount_minor = 4500000, from = UNREGISTERED) {
  await h.tool('lookup_customer', { run_id: RUN, from_number: from, claimed_name: 'Saksham Mishra' });
  const res = await h.tool('propose_action', {
    run_id: RUN,
    from_number: from,
    action: 'transfer.new_payee',
    params: { amount_minor, currency: 'INR', payee_account_last4: '4471', payee_ifsc: 'AERO0000001' },
    readback_confirmed: true,
  });
  await h.settle();
  return ((await res.json()) as { request_id: string }).request_id;
}

describe('passkey registration', () => {
  it('registers through options → verify, once per challenge, for customer sessions only', async () => {
    const token = await h.customerToken();
    const options = await h.web('/web/passkeys/register/options', {}, token);
    expect(options.status).toBe(200);
    const { options: creation } = (await options.json()) as {
      options: Parameters<Awaited<ReturnType<typeof softPasskey>>['register']>[0];
    };
    expect(creation).toMatchObject({
      rp: { id: 'localhost' },
      attestation: 'none',
      user: { displayName: 'Saksham Mishra' },
    });
    const key = await softPasskey();
    const credential = await key.register(creation, WEB_ORIGIN);
    expect((await h.web('/web/passkeys/register/verify', { response: credential }, token)).status).toBe(200);
    const replay = await h.web('/web/passkeys/register/verify', { response: credential }, token);
    expect(replay.status).toBe(400);
    const console_ = await h.web('/web/passkeys/register/options', {}, await h.consoleToken());
    expect(await code(console_)).toBe('E_UNAUTHORIZED');
    // Mirrored to TiDB through the outbox.
    await h.fireAlarm();
    expect(h.mirror.items.some((i) => i.kind === 'credentials')).toBe(true);
  });
});

describe('the Confirm passkey leg', () => {
  it('approve with the passkey → approved; above the new-payee cap the approval still goes to a specialist', async () => {
    const passkey = await h.registerPasskey();
    const aero = await h.listen('aero');
    const request_id = await stepUp();
    await tick();
    expect(aero.some((m) => m.type === 'confirm_request' && m.request_id === request_id)).toBe(true);
    const res = await h.approve(request_id, passkey);
    expect(await res.json()).toEqual({ ok: true, status: 'approved' });
    await h.settle();
    // ₹45,000 > cap_first_24h (₹10,000): GATE.md clarification 9 → hold with a handoff, never executed.
    expect(await h.hub.requestState(request_id)).toMatchObject({ final_outcome: 'hold', status: 'held' });
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up', 'hold']);
    expect(h.aero.calls.some((c) => c.path === '/core/transfers')).toBe(false);
  });

  it('approve within the cap from the registered number executes; the Confirm call still queued is stopped', async () => {
    const passkey = await h.registerPasskey(-8);
    const request_id = await stepUp(500000, REGISTERED);
    const res = await h.approve(request_id, passkey);
    expect(res.status).toBe(200);
    await h.settle();
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up', 'approved', 'done']);
    expect(h.bolna.stopped).toHaveLength(1);
  });

  it('decline needs no passkey; a later answer from either leg is refused (first answer wins)', async () => {
    const passkey = await h.registerPasskey();
    const request_id = await stepUp();
    const token = await h.customerToken();
    expect(await (await h.web(`/web/approvals/${request_id}/decline`, {}, token)).json()).toEqual({
      ok: true,
      status: 'declined',
    });
    const late = await h.approve(request_id, passkey);
    expect(late.status).toBe(400);
    const again = await h.web(`/web/approvals/${request_id}/decline`, {}, token);
    expect(await code(again)).toBe('E_BAD_REQUEST');
    await h.settle();
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up', 'denied']);
  });

  it('another customer cannot see or answer it; no passkey → register first; a bad assertion is refused', async () => {
    const request_id = await stepUp();
    const other = await h.customerToken('cus_saksham_us');
    expect((await h.web(`/web/approvals/${request_id}/options`, {}, other)).status).toBe(404);
    expect((await h.web(`/web/approvals/${request_id}/decline`, {}, other)).status).toBe(404);
    expect((await h.web('/web/approvals/req_nope/options', {}, other)).status).toBe(404);
    const token = await h.customerToken();
    const none = await h.web(`/web/approvals/${request_id}/options`, {}, token);
    expect(await none.json()).toMatchObject({ error: { message: 'Register a passkey first' } });
    const passkey = await h.registerPasskey();
    const options = (await (await h.web(`/web/approvals/${request_id}/options`, {}, token)).json()) as {
      options: Parameters<typeof passkey.authenticate>[0];
    };
    const forged = await passkey.authenticate(options.options, 'https://evil.test');
    expect((await h.web(`/web/approvals/${request_id}/verify`, { response: forged }, token)).status).toBe(
      400,
    );
    expect(await h.hub.requestState(request_id)).toMatchObject({ status: 'awaiting_confirmation' });
  });

  it('after the 60 s timeout an approval is refused', async () => {
    const passkey = await h.registerPasskey();
    const request_id = await stepUp();
    h.clock.advance(61_000);
    await h.fireAlarm();
    expect((await h.approve(request_id, passkey)).status).toBe(400);
  });
});

describe('GET /web/aero/home', () => {
  it('balance, activity, card and loan from Aero Core; alerts and pending approvals from the Hub', async () => {
    await h.registerPasskey();
    const request_id = await stepUp();
    await h.tool('propose_action', {
      run_id: RUN,
      from_number: UNREGISTERED,
      action: 'transfer.saved',
      params: { amount_minor: 1000, currency: 'INR', payee_id: 'payee_mom' },
      readback_confirmed: false,
    });
    const home = AeroHomeSchema.parse(
      await (await h.web('/web/aero/home', undefined, await h.customerToken())).json(),
    );
    expect(home.customer).toEqual({ id: 'cus_saksham', name: 'Saksham Mishra' });
    expect(home.accounts).toEqual([
      { type: 'savings', last4: '3094', balance: { amount_minor: 52000000, currency: 'INR' } },
    ]);
    expect(home.card).toEqual({ last4: '8812', status: 'active' });
    expect(home.loan).toMatchObject({
      id: 'loan_personal_1',
      emi_day: 5,
      outstanding: { amount_minor: 18750000, currency: 'INR' },
    });
    expect(home.activity.length).toBeGreaterThan(0);
    expect(home.passkey_registered).toBe(true);
    expect(home.pending_approvals.map((p) => p.request_id)).toEqual([request_id]);
    expect(home.alerts.map((a) => a.kind)).toEqual(['blocked', 'approval']);
    expect((await h.web('/web/aero/home', undefined, await h.consoleToken())).status).toBe(401);
  });

  it('broadcasts core_update after an Aero Core write, so the app refetches', async () => {
    const aero = await h.listen('aero');
    await h.tool('propose_action', {
      run_id: RUN,
      from_number: REGISTERED,
      action: 'card.freeze',
      params: { card_last4: '8812' },
      readback_confirmed: true,
    });
    await h.settle();
    await tick();
    const update = aero.find(
      (m): m is Extract<WsMessage, { type: 'core_update' }> => m.type === 'core_update',
    );
    expect(update).toMatchObject({
      customer_id: 'cus_saksham',
      balance: { currency: 'INR' },
      activity: { summary: 'The card ending 8812 is frozen' },
    });
  });
});

describe('ledger, Stage and CORS', () => {
  it('lists the newest entries oldest first and verifies the chain against the head (console only)', async () => {
    await stepUp();
    const token = await h.consoleToken();
    const list = LedgerListResponseSchema.parse(
      await (await h.web('/web/ledger?limit=2', undefined, token)).json(),
    );
    expect(list.entries).toHaveLength(2);
    expect(list.entries[0]!.seq).toBeLessThan(list.entries[1]!.seq);
    expect(list.head_hash).toBe(list.entries[1]!.hash);
    expect(
      LedgerVerifyResponseSchema.parse(await (await h.web('/web/ledger/verify', undefined, token)).json()),
    ).toMatchObject({
      ok: true,
    });
    expect((await h.web('/web/ledger', undefined, await h.customerToken())).status).toBe(401);
  });

  it('runs a scenario in text mode against the live Hub and reports progress over the WebSocket', async () => {
    const stage = await h.listen('stage');
    const res = await h.web('/web/stage/run/1', { mode: 'text' }, await h.consoleToken());
    const body = StageRunResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ scenario: '1', mode: 'text' });
    await h.settle();
    await tick();
    const progress = stage
      .filter((m) => m.type === 'test_progress')
      .map((m) => (m.type === 'test_progress' ? m.status : ''));
    expect(progress).toEqual(['running', 'passed']);
    expect(stage.some((m) => m.type === 'decision')).toBe(true);
    expect((await h.web('/web/stage/run/1', { mode: 'voice' }, await h.consoleToken())).status).toBe(400);
    expect((await h.web('/web/stage/run/99', { mode: 'text' }, await h.consoleToken())).status).toBe(404);
    expect(await (await h.web('/web/stage/region', { region: 'US' }, await h.consoleToken())).json()).toEqual(
      { ok: true },
    );
    expect(await h.hub.stageRegion()).toBe('US');
    expect((await h.web('/web/stage/region', { region: 'US' }, await h.customerToken())).status).toBe(401);
  });

  it('answers CORS preflight for the web origin only, before the session check', async () => {
    const preflight = (origin: string) =>
      h.fetch('/web/aero/home', {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      });
    const ok = await preflight(WEB_ORIGIN);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(ok.headers.get('access-control-allow-headers')).toContain('authorization');
    const evil = await preflight('https://evil.test');
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const get = await h.web('/web/aero/home', undefined, await h.customerToken());
    expect(get.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
  });
});
