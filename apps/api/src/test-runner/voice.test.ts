import { describe, expect, it } from 'vitest';
import { appHarness } from '../../test/fixtures/app';
import type { CallState, RequestRecord } from '../hub/types';
import { aeroCallFor, scoreVoiceRun } from './voice';

const call = (run_id: string, started_at: number, from_last4: string | null = '6379'): CallState => ({
  id: `call_${run_id}`,
  run_id,
  call_sid: null,
  channel: 'phone',
  region: 'IN',
  customer_id: null,
  registered: false,
  number_hash: null,
  from_last4,
  kind: 'unknown',
  pass_id: null,
  app_session_customer_id: null,
  started_at,
  ended_at: started_at + 60_000,
  purpose: null,
});
const request = (run_id: string, action: string, outcome: string, status = 'executed', granted = true) =>
  ({
    request_id: 'req_1',
    run_id,
    action,
    decision: { outcome },
    status,
    execution: granted ? { jti: 'j', reference: 'r', at: 1, summary: 's' } : null,
  }) as unknown as RequestRecord;

describe('voice runs', () => {
  it('finds Aero’s side of the persona call by number B and start time', () => {
    const calls = [call('late', 200_000), call('other', 10_500, '0042'), call('aero', 11_000)];
    expect(aeroCallFor(calls, '6379', 10_000)?.run_id).toBe('aero');
    expect(aeroCallFor(calls, '6379', 500_000)).toBeNull();
  });

  it('passes when the persona’s action was decided as expected, and says why otherwise', () => {
    const aero = call('aero', 0);
    const base = {
      persona: 'test-polite-hindi',
      execution_id: 'ex',
      call_status: 'completed',
      aero,
    } as const;
    expect(scoreVoiceRun({ ...base, ended: false, requests: [] }).status).toBe('running');
    expect(
      scoreVoiceRun({ ...base, ended: true, requests: [request('aero', 'card.freeze', 'allow')] }),
    ).toMatchObject({
      status: 'passed',
      outcomes: [{ action: 'card.freeze', outcome: 'allow' }],
    });
    const wrong = scoreVoiceRun({
      ...base,
      ended: true,
      requests: [request('aero', 'card.freeze', 'deny', 'refused')],
    });
    expect(wrong).toMatchObject({ status: 'failed', notes: [expect.stringMatching(/decided deny/)] });
    const ungranted = scoreVoiceRun({
      ...base,
      ended: true,
      requests: [request('aero', 'card.freeze', 'allow', 'executed', false)],
    });
    expect(ungranted.notes).toContainEqual(expect.stringMatching(/without a recorded grant/));
    const missing = scoreVoiceRun({ ...base, aero: null, ended: true, requests: [] });
    expect(missing.notes).toEqual([
      expect.stringMatching(/no Aero call/),
      expect.stringMatching(/did not propose/),
    ]);
  });

  it('keeps the voice button off until a persona agent exists, and places no call', async () => {
    const h = await appHarness();
    const token = await h.consoleToken();
    const list = (await (await h.web('/web/tests/voice', undefined, token)).json()) as {
      personas: { id: string; ready: boolean }[];
    };
    expect(list.personas.map((p) => [p.id, p.ready])).toEqual([
      ['test-polite-hindi', false],
      ['test-hinglish-noisy', false],
      ['test-impatient-en', false],
    ]);
    expect((await h.web('/web/tests/voice/test-polite-hindi', {}, token)).status).toBe(404);
    expect((await h.web('/web/tests/voice/attacker', {}, token)).status).toBe(404);
    expect(h.bolna.calls).toHaveLength(0);
  });
});
