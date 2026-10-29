import { describe, expect, it } from 'vitest';
import {
  callLine,
  confirmRequest,
  confirmResolved,
  decisionMessage,
  HASH_A,
  HASH_B,
  ledgerAppend,
} from '@/test/fixtures';
import { initialStageState, type StageAction, stageReducer, type StageState } from './stage-state';

const run = (actions: StageAction[], from: StageState = initialStageState) =>
  actions.reduce(stageReducer, from);
const ws = (message: Parameters<typeof decisionMessage>[0] | ReturnType<typeof callLine>): StageAction => ({
  type: 'ws',
  message: message as never,
});

describe('stageReducer', () => {
  it('collects a call transcript and a timeline', () => {
    const s = run([ws(callLine('caller', 'freeze my card')), ws(callLine('agent', 'Done.'))]);
    expect(s.transcript.map((l) => l.text)).toEqual(['freeze my card', 'Done.']);
    expect(s.timeline.map((t) => t.kind)).toEqual(['Call · aero', 'Call · aero']);
  });

  it("splits Bolna's end-of-call transcript into agent and caller lines (voice smoke call 2)", () => {
    const blob = 'assistant: Hello! How can I help? user: Please waive my late fee.\nassistant: Done!';
    const s = run([ws(callLine('system', blob))]);
    expect(s.transcript.map((l) => [l.speaker, l.text])).toEqual([
      ['agent', 'Hello! How can I help?'],
      ['caller', 'Please waive my late fee.'],
      ['agent', 'Done!'],
    ]);
    expect(run([ws(callLine('system', 'Pass verified'))]).transcript.map((l) => l.text)).toEqual([
      'Pass verified',
    ]);
  });

  it('keeps the latest decision and the confirm lifecycle', () => {
    const s = run([
      { type: 'ws', message: decisionMessage('step_up') },
      { type: 'ws', message: confirmRequest() },
    ]);
    expect(s.decision?.decision.outcome).toBe('step_up');
    expect(s.confirmRequest?.channels).toEqual(['passkey', 'callback']);
    expect(s.confirmResolved).toBeNull();
    const resolved = run([{ type: 'ws', message: confirmResolved('declined') }], s);
    expect(resolved.confirmResolved?.status).toBe('declined');
    expect(resolved.timeline.at(-1)).toMatchObject({ kind: 'Confirm declined', tone: 'bad' });
    // a new request clears the previous answer
    expect(run([{ type: 'ws', message: confirmRequest() }], resolved).confirmResolved).toBeNull();
  });

  it('tones every outcome on the timeline', () => {
    const tones = (['allow', 'step_up', 'hold', 'deny'] as const).map(
      (o) => run([{ type: 'ws', message: decisionMessage(o) }]).timeline[0]?.tone,
    );
    expect(tones).toEqual(['good', 'warn', 'hold', 'bad']);
  });

  it('applies core updates, handoffs and test progress', () => {
    const s = run([
      {
        type: 'ws',
        message: {
          type: 'core_update',
          at: '2026-10-28T10:00:00.000Z',
          customer_id: 'cus_saksham',
          balance: { amount_minor: 100, currency: 'INR' },
          activity: { reference: 'AERO-ABC123', summary: 'Card frozen', amount: null },
        },
      },
      {
        type: 'ws',
        message: {
          type: 'handoff',
          at: '2026-10-28T10:00:00.000Z',
          handoff_id: 'hnd_1',
          request_id: 'req_01J9ZZZZZZZZZZZZZZZZZZZZZ1',
          reasons: ['S_COACHING'],
          status: 'open',
        },
      },
      {
        type: 'ws',
        message: {
          type: 'test_progress',
          at: '2026-10-28T10:00:00.000Z',
          test_run_id: 'run_1',
          scenario_id: '4',
          status: 'passed',
          completed: 1,
          total: 1,
        },
      },
    ]);
    expect(s.balance).toEqual({ amount_minor: 100, currency: 'INR' });
    expect(s.activity[0]?.summary).toBe('Card frozen');
    expect(s.handoff?.status).toBe('open');
    expect(s.progress?.status).toBe('passed');
    expect(s.timeline.map((t) => t.kind)).toEqual(['Aero Core', 'Handoff', 'Scenario']);
  });

  it('a core update without activity keeps the activity list', () => {
    const s = run([
      {
        type: 'ws',
        message: {
          type: 'core_update',
          at: '2026-10-28T10:00:00.000Z',
          customer_id: 'cus_saksham',
          balance: { amount_minor: 5, currency: 'INR' },
          activity: null,
        },
      },
    ]);
    expect(s.activity).toEqual([]);
    expect(s.timeline[0]?.label).toBe('balance updated');
  });

  it('appends ledger entries once, extends a verified chain and flags a broken one', () => {
    let s = run([
      { type: 'ledger_loaded', lines: [] },
      { type: 'chain_checked', result: { ok: true, entries: 0, head_hash: null } },
    ]);
    s = run([{ type: 'ws', message: ledgerAppend(1) }], s);
    expect(s.chain).toEqual({ state: 'verified', entries: 1 });
    s = run([{ type: 'ws', message: ledgerAppend(1) }], s); // duplicate (after a refetch)
    expect(s.ledger).toHaveLength(1);
    s = run([{ type: 'ws', message: ledgerAppend(2, 'executed', false) }], s);
    expect(s.chain).toEqual({ state: 'broken', firstBadSeq: 2 });
    expect(s.ledger[1]).toMatchObject({ seq: 2, hash: HASH_B, prev_hash: HASH_A, chain_ok: false });
  });

  it('an unchecked chain stays unchecked after a good append, and verify results map to states', () => {
    expect(run([{ type: 'ws', message: ledgerAppend(1) }]).chain).toEqual({ state: 'unchecked' });
    expect(
      run([{ type: 'chain_checked', result: { ok: false, entries: 3, first_bad_seq: 2 } }]).chain,
    ).toEqual({ state: 'broken', firstBadSeq: 2 });
  });

  it('starting a run clears the scene but keeps the ledger, chain and balance', () => {
    let s = run([
      { type: 'ws', message: callLine('caller', 'hi') },
      { type: 'ws', message: decisionMessage('deny') },
      { type: 'ws', message: ledgerAppend(1) },
    ]);
    s = run([{ type: 'run_started' }], s);
    expect(s.transcript).toEqual([]);
    expect(s.decision).toBeNull();
    expect(s.timeline).toEqual([]);
    expect(s.ledger).toHaveLength(1);
  });

  it('caps the lists', () => {
    const s = run(Array.from({ length: 80 }, (_, i) => ws(callLine('caller', `line ${i}`))));
    expect(s.transcript).toHaveLength(50);
    expect(s.timeline).toHaveLength(50);
    expect(s.transcript.at(-1)?.text).toBe('line 79');
  });
});
