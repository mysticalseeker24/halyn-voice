import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, REGISTERED, tick } from '../../test/fixtures/app';

// Coaching layer 2 (ADR-024, invariants 3/4): Sarvam reads the quotes after propose_action answered. A money allow or
// step_up waits for it; a high score turns it into the coaching hold before any event, grant, approval sheet or
// Confirm call; a low score or a dead Sarvam lets it go on as decided. Real Hub, Gate, ledger and Aero Core.

const RUN = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const NEW_PAYEE = {
  amount_minor: 4500000,
  currency: 'INR',
  payee_account_last4: '4471',
  payee_ifsc: 'AERO0000001',
  payee_name: 'Ravi',
};
// Below layer 1's threshold: no lexicon cue fires on these words.
const QUOTES = ['My nephew said I must move the money today', 'He told me to keep this between us'];

function sarvam(probability: number | 'down') {
  const asked: string[] = [];
  const fetch = async (request: Request) => {
    asked.push(await request.text());
    if (probability === 'down') return new Response('unavailable', { status: 503 });
    const content = JSON.stringify({ probability, cues: ['third_party_instructions'] });
    return Response.json({ choices: [{ message: { content } }] });
  };
  return { fetch, asked };
}

let h: AppHarness;
afterEach(() => vi.restoreAllMocks());

async function propose(action: string, params: Record<string, unknown>, caller_quotes = QUOTES) {
  const res = await h.tool('propose_action', {
    run_id: RUN,
    from_number: REGISTERED,
    action,
    params,
    readback_confirmed: true,
    caller_quotes,
  });
  expect(res.status).toBe(200);
  const { request_id } = (await res.json()) as { request_id: string };
  await h.settle();
  await tick();
  const record = await h.hub.requestState(request_id);
  if (!record) throw new Error('no record');
  return record;
}

describe('coaching layer 2', () => {
  it('a coached step-up becomes the hold: no step_up event, no Confirm call, no approval sheet, no answer counts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const llm = sarvam(0.9);
    h = await appHarness({ sarvam: llm.fetch });
    const aero = await h.listen('aero');
    const passkey = await h.registerPasskey();
    const record = await propose('transfer.new_payee', NEW_PAYEE);

    expect(llm.asked).toHaveLength(1);
    expect(record).toMatchObject({ status: 'held', confirm: null, decision: { outcome: 'hold' } });
    expect(record.screening).toBeUndefined();
    expect(record.decision.reasons).toEqual(expect.arrayContaining(['S_COACHING', 'H_SPECIALIST']));
    expect(record.coaching.cues).toContain('llm_third_party_instructions');
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['hold']);
    expect(h.bolna.calls).toHaveLength(0);
    expect(aero.some((m) => m.type === 'confirm_request')).toBe(false);
    expect(h.aero.calls).toHaveLength(0);
    expect((await h.approve(record.request_id, passkey)).status).toBe(404);

    const [handoff] = await h.hub.handoffs();
    expect(handoff).toMatchObject({
      request_id: record.request_id,
      run_id: RUN,
      status: 'open',
      checkin: { why: 'coaching', status: 'scheduled' },
    });
    const ledger = await h.ledger();
    const held = ledger.find((e) => e.type === 'decided' && e.payload.layer === 'llm');
    expect(held?.payload).toMatchObject({ outcome: 'hold' });
    expect(ledger.some((e) => e.type === 'grant_issued')).toBe(false);
  });

  it('a request still screening refuses every answer; none of them counts once screening clears it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const llm = sarvam(0.1);
    h = await appHarness({ sarvam: async (request) => (await gate, llm.fetch(request)) });
    const passkey = await h.registerPasskey();
    const res = await h.tool('propose_action', {
      run_id: RUN,
      from_number: REGISTERED,
      action: 'transfer.new_payee',
      params: NEW_PAYEE,
      readback_confirmed: true,
      caller_quotes: QUOTES,
    });
    const { request_id } = (await res.json()) as { request_id: string };
    await tick();
    expect(await h.hub.requestState(request_id)).toMatchObject({ screening: true });
    expect((await h.approve(request_id, passkey)).status).not.toBe(200);
    const token = await h.customerToken();
    expect((await h.web(`/web/approvals/${request_id}/decline`, {}, token)).status).not.toBe(200);
    expect(h.bolna.events.get(RUN) ?? []).toEqual([]);

    release();
    await h.settle();
    await tick();
    expect(await h.hub.requestState(request_id)).toMatchObject({
      status: 'awaiting_confirmation',
      final_outcome: null,
    });
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up']);
  });

  it('a low score lets the step-up go on: event, Confirm call and approval sheet only after screening', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    h = await appHarness({ sarvam: sarvam(0.1).fetch });
    const aero = await h.listen('aero');
    const record = await propose('transfer.new_payee', NEW_PAYEE);
    expect(record).toMatchObject({ status: 'awaiting_confirmation', decision: { outcome: 'step_up' } });
    expect(record.screening).toBeUndefined();
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['step_up']);
    expect(aero.filter((m) => m.type === 'confirm_request')).toHaveLength(1);
  });

  it('a coached allow is held before any grant; Sarvam down → layer 1 alone (allowed and executed)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const saved = { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' };
    h = await appHarness({ sarvam: sarvam(0.95).fetch });
    const held = await propose('transfer.saved', saved);
    expect(held.status).toBe('held');
    expect(h.aero.calls).toHaveLength(0);

    h = await appHarness({ sarvam: sarvam('down').fetch });
    const allowed = await propose('transfer.saved', saved);
    expect(allowed.status).toBe('executed');
    expect(h.bolna.events.get(RUN)?.map((e) => e.event)).toEqual(['done']);
  });

  it('does not screen what cannot change: no quotes, or an action that moves no money', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const llm = sarvam(0.99);
    h = await appHarness({ sarvam: llm.fetch });
    const freeze = await propose('card.freeze', { card_last4: '8812' });
    expect(freeze.status).toBe('executed');
    expect(llm.asked).toHaveLength(0);
  });
});
