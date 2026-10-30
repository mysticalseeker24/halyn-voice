import { GENESIS_HASH, type LedgerEntry } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import type { RequestRecord } from '../hub/types';
import { type Harness, runScenario } from './runner';
import { bundledSpec, type Scenario } from './spec';

// The runner must FAIL loudly when Halyn misbehaves: a fake harness that answers wrongly on purpose. (The real
// scenarios run in apps/api/test/scenarios against the real app.)

const spec = bundledSpec();
const scenario = (id: string): Scenario => {
  const s = spec.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};

function record(over: Partial<RequestRecord> = {}): RequestRecord {
  return {
    request_id: 'req_1',
    run_id: 'run',
    idem_key: 'k',
    call_id: 'call_1',
    customer_id: 'cus_saksham',
    region: 'IN',
    channel: 'phone',
    action: 'card.freeze',
    params: {},
    params_hash: 'a'.repeat(64),
    readback_confirmed: true,
    caller_quotes: [],
    coaching: { score: 0, cues: [] },
    summary: 'x',
    created_at: 0,
    gate: {
      action: 'card.freeze',
      outcome: 'deny',
      tier: null,
      base_tier: null,
      proof: 'none',
      signals: [],
      reasons: ['E_FAIL_CLOSED'],
      amount: null,
      confirm: null,
    },
    decision: {
      request_id: 'req_1',
      outcome: 'deny',
      tier: null,
      base_tier: null,
      reasons: ['E_FAIL_CLOSED'],
    },
    pack_sha: null,
    pass_id: null,
    status: 'refused',
    final_outcome: null,
    execute_at: null,
    confirm: null,
    execution: null,
    failure: null,
    handoff_id: null,
    last_event: null,
    ...over,
  };
}

function fake(over: Partial<Harness> = {}, entries: LedgerEntry[] = []): Harness {
  return {
    mode: 'test',
    numbers: {
      registered: '+919000000003',
      unregistered: '+919000000001',
      assistant: '+918065356379',
      unknown_ai: '+919000000002',
    },
    newRunId: () => 'run',
    webCall: async () => null,
    tool: async (name) =>
      name === 'propose_action'
        ? { status: 200, body: { request_id: 'req_1', status: 'pending' }, ms: 1200 }
        : { status: 200, body: { code: '123456', valid: false }, ms: 1 },
    settle: async () => undefined,
    advance: async () => undefined,
    fireTimeouts: async () => false,
    passkey: async () => false,
    passToken: () => null,
    events: () => [{ event: 'deny', properties: { request_id: 'req_1', reason: 'E_FAIL_CLOSED' } }],
    outbound: () => [],
    coreCalls: () => [{ method: 'POST', path: '/core/transfers', granted: false, status: 200 }],
    directCore: async () => ({ status: 200, body: {} }),
    request: async () => record(),
    ledger: async () => ({ entries, head: null }),
    messages: () => [],
    logs: () => ['caller +919000000003 said hello'],
    ...over,
  };
}

/** An entry that cannot be the start of a chain (seq 2, bogus hash). */
function brokenEntry(): LedgerEntry {
  return {
    seq: 2,
    tenant_id: 'ten_aero',
    type: 'proposed',
    ref_id: 'req_1',
    payload: {},
    prev_hash: GENESIS_HASH,
    hash: 'c'.repeat(64),
    created_at: '2026-10-28T05:00:00.000Z',
  };
}

describe('runScenario reports every way Halyn can be wrong', () => {
  it('wrong decision, missing reasons, wrong events, slow reply, an ungranted Aero Core write, leaked numbers', async () => {
    const result = await runScenario(spec, scenario('1'), fake());
    expect(result.passed).toBe(false);
    const text = result.failures.join('\n');
    expect(text).toMatch(/decision deny, expected allow/);
    expect(text).toMatch(/reasons lack P_PROTECTIVE/);
    expect(text).toMatch(/Aero Core was not called/);
    expect(text).toMatch(/events \[\], expected \[done\]/);
    expect(text).toMatch(/took 1200 ms/);
    expect(text).toMatch(/without a grant/);
    expect(text).toMatch(/unmasked numbers/);
  });

  it('a scenario that needs a Pass is skipped, not failed, where no Pass token can be had (live Run all)', async () => {
    const result = await runScenario(spec, scenario('5'), fake({ mode: 'live', passToken: () => null }));
    expect(result.failures).toEqual([]);
    expect(result.skipped.join(' ')).toMatch(/Pass/);
    expect(result.passed).toBe(true);
    expect(result.steps).toEqual([]);
  });

  it('the 300 ms propose budget binds the deployed API; in-process tests allow load up to 1 s (finding 6)', async () => {
    const slow = (mode: Harness['mode']) =>
      fake({
        mode,
        tool: async (name) =>
          name === 'propose_action'
            ? { status: 200, body: { request_id: 'req_1', status: 'pending' }, ms: 450 }
            : { status: 200, body: {}, ms: 1 },
      });
    const failures = async (mode: Harness['mode']) =>
      (await runScenario(spec, scenario('1'), slow(mode))).failures.join(' | ');
    expect(await failures('live')).toMatch(/took 450 ms \(budget 300 ms\)/);
    expect(await failures('test')).not.toMatch(/took 450 ms/);
  });

  it('an event that does not match the decision, or follows it out of order, fails every step (rule 3)', async () => {
    const ev = (event: string) => ({ event, properties: { request_id: 'req_1' } }) as never;
    const heard = (events: string[]) => {
      let first = true;
      return () => (first ? ((first = false), []) : events.map(ev));
    };
    const wrong = await runScenario(spec, scenario('8'), fake({ events: heard(['allow', 'done']) }));
    expect(wrong.failures.join('\n')).toMatch(/first event allow, decision deny/);
    const order = await runScenario(spec, scenario('8'), fake({ events: heard(['deny', 'done']) }));
    expect(order.failures.join('\n')).toMatch(/event done cannot follow deny/);
    const silent = await runScenario(spec, scenario('8'), fake({ events: () => [] }));
    expect(silent.failures.join('\n')).toMatch(/no event reached the call \(decision deny\)/);
  });

  it('a step-up that never rings, a passkey the harness cannot sign, a missing request, a broken ledger', async () => {
    const broken = [brokenEntry()];
    const r3 = await runScenario(spec, scenario('3'), fake({ request: async () => null }, broken));
    expect(r3.failures.join('\n')).toMatch(/no request recorded/);
    expect(r3.failures.join('\n')).toMatch(/ledger chain does not verify/);
    expect(r3.skipped.join('\n')).toMatch(/passkey decline: not possible/);
    const r6 = await runScenario(spec, scenario('6'), fake());
    expect(r6.failures.join('\n')).toMatch(/names no usable Pass|never placed/);
    const r3b = await runScenario(
      spec,
      scenario('3b'),
      fake({ mode: 'live', messages: () => null, logs: () => null }),
    );
    expect(r3b.skipped.join('\n')).toMatch(/Hub alarm/);
  });

  it('direct Aero Core calls and repeated proposals are checked too', async () => {
    const r11 = await runScenario(spec, scenario('11'), fake());
    expect(r11.failures.join('\n')).toMatch(/direct \/core\/transfers: 200/);
    const r12 = await runScenario(spec, scenario('12'), fake());
    expect(r12.failures.join('\n')).toMatch(/#1: decision deny, expected allow/);
    expect(r12.steps).toHaveLength(10);
    const r10 = await runScenario(spec, scenario('10'), fake());
    // Without a browser call (live mode, or a harness that cannot start one) scenario 10 is reported as skipped.
    expect(r10.skipped.join('\n')).toMatch(/browser call: not possible/);
    expect(r10.steps).toHaveLength(0);
  });

  it('scenario 12 is one new call per transfer: ten run ids, each identified by the registered number (invariant 7)', async () => {
    const runIds: string[] = [];
    let n = 0;
    await runScenario(
      spec,
      scenario('12'),
      fake({
        newRunId: () => `run-${(n += 1)}`,
        tool: async (name, body) => {
          if (name === 'propose_action') runIds.push(String(body.run_id));
          return name === 'propose_action'
            ? { status: 200, body: { request_id: 'req_1', status: 'pending' }, ms: 5 }
            : { status: 200, body: {}, ms: 1 };
        },
      }),
    );
    expect(runIds).toHaveLength(10);
    expect(new Set(runIds).size).toBe(10);
  });

  it('a harness error is a failure, never a crash', async () => {
    const result = await runScenario(
      spec,
      scenario('1'),
      fake({ tool: async () => Promise.reject(new Error('boom')) }),
    );
    expect(result.failures).toEqual(['runner error: boom']);
  });
});
