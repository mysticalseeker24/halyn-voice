import {
  type LedgerEntry,
  type LedgerEntryType,
  maskNumbers,
  type OutcomeEvent,
  type Region,
  verifyLedgerChain,
  type WsMessage,
} from '@halyn/shared';
import type { RequestRecord } from '../hub/types';
import type { CallerFrom, Expect, ProposeStep, Scenario, ScenarioSpec, Step } from './spec';

// The text-mode scenario runner (docs/SCENARIOS.md, PROMPTS.md Step 7): plays one scenario of scenarios.yaml against
// the REAL tools, Gate, Pass, Hub, ledger and Aero Core, and checks every expectation plus "Rules every scenario also
// checks". Only Bolna (the caller's words become tool calls; events are recorded) and the customer's answers are
// simulated — through a Harness, so the same runner drives Miniflare tests (apps/api/test/scenarios) and the Stage's
// live text runs (live.ts).

export interface ToolCall {
  status: number;
  body: unknown;
  /** Wall time of the request as the caller saw it (propose_action must answer < 300 ms). */
  ms: number;
}

export interface Harness {
  /** "live" cannot move time or sign a passkey; expectations that need either are reported as skipped. */
  mode: 'test' | 'live';
  numbers: Record<Exclude<CallerFrom, 'app_session'>, string>;
  newRunId(): string;
  /**
   * A browser call for the scenario's customer in `region` (POST /web/calls/session: the run id carries the app
   * session); null when this harness cannot start one (live mode needs the browser).
   */
  webCall(region: Region): Promise<string | null>;
  tool(name: string, body: Record<string, unknown>): Promise<ToolCall>;
  /** Wait for everything the last requests started in the background (waitUntil). */
  settle(): Promise<void>;
  /** Let time pass (tests move the clocks; live waits a capped while). */
  advance(ms: number): Promise<void>;
  /** Fire due confirmation timeouts (tests run the Hub alarm); false when the Hub's own alarm must do it. */
  fireTimeouts(): Promise<boolean>;
  /** The Aero app's passkey leg. `approve` needs a registered (test) passkey; returns false when it cannot. */
  passkey(request_id: string, answer: 'approve' | 'decline'): Promise<{ status: number } | false>;
  /** A Pass token for the scenario's assistant (`pass: valid_view_freeze_emi`), or null. */
  passToken(name: string): string | null;
  /** Events Halyn sent into the call `run_id`, in order. */
  events(run_id: string): OutcomeEvent[];
  /** Confirm calls Halyn placed: the Bolna execution id per request. */
  outbound(): { request_id: string; execution_id: string }[];
  /** Aero Core requests so far (method, path, whether a grant was attached, status). */
  coreCalls(): { method: string; path: string; granted: boolean; status: number }[];
  /** A request straight to Aero Core with no grant (scenario 11). */
  directCore(path: string): Promise<{ status: number; body: unknown }>;
  request(request_id: string): Promise<RequestRecord | null>;
  ledger(): Promise<{ entries: LedgerEntry[]; head: { seq: number; hash: string } | null }>;
  /** WebSocket messages the apps received, per role; null when the harness cannot listen (live mode). */
  messages(role: 'aero' | 'stage'): WsMessage[] | null;
  /** Log lines written so far (masking check); null when the harness cannot see them. */
  logs(): string[] | null;
}

export interface StepReport {
  label: string;
  request_id: string | null;
  decision: string | null;
  final: string | null;
  reasons: string[];
  events: string[];
  propose_ms: number | null;
}

export interface ScenarioResult {
  id: string;
  title: string;
  passed: boolean;
  failures: string[];
  skipped: string[];
  steps: StepReport[];
  propose_ms: number[];
  /** Aero Core writes that succeeded without a grant (Halyn Test scorecard; must be 0, invariant 1). */
  ungranted_writes: number;
}

const PROPOSE_BUDGET_MS = 300;
const CAUSAL: LedgerEntryType[] = [
  'proposed',
  'decided',
  'confirm_requested',
  'confirmed',
  'grant_issued',
  'executed',
];

interface Run {
  scenario: Scenario;
  spec: ScenarioSpec;
  harness: Harness;
  run_id: string;
  from: string | null;
  failures: string[];
  skipped: string[];
  steps: StepReport[];
  propose_ms: number[];
  requests: string[];
  directCalls: number;
}

function check(run: Run, ok: boolean, what: string): void {
  if (!ok) run.failures.push(what);
}

function eventNames(events: readonly OutcomeEvent[]): string[] {
  return events.map((e) => e.event);
}

async function identify(run: Run, region: Scenario['region']): Promise<void> {
  const { scenario, harness, spec } = run;
  if (scenario.caller.from === 'app_session' || run.from === null) return;
  const claimed = scenario.caller.kind === 'human' ? spec.customer.name : undefined;
  const res = await harness.tool('lookup_customer', {
    run_id: run.run_id,
    from_number: run.from,
    ...(claimed ? { claimed_name: claimed } : {}),
  });
  check(run, res.status === 200, `lookup_customer answered ${res.status} (${region})`);
  // An assistant presents its Pass at the start of every call; scenario 5 shows that step, scenario 6 assumes it.
  if (scenario.caller.pass && scenario.caller.pass !== 'none' && !scenario.steps.some((s) => s.verify_pass))
    await verifyPassStep(run, { verify_pass: { code: 'from_pass' }, expect: { valid: true } });
}

async function verifyPassStep(run: Run, step: Step): Promise<void> {
  const { harness, scenario } = run;
  const token = harness.passToken(scenario.caller.pass ?? '');
  if (!token || run.from === null) {
    run.failures.push('verify_pass: the scenario names no usable Pass');
    return;
  }
  const minted = await harness.tool('get_pass_code', {
    run_id: `${run.run_id}-assistant`,
    pass_token: token,
    from_number: run.from,
  });
  const code = (minted.body as { code?: string }).code;
  check(run, minted.status === 200 && typeof code === 'string', `get_pass_code answered ${minted.status}`);
  // The assistant says the digits with pauses, as it would on the call.
  const spoken = (code ?? '').split('').join(' ');
  const res = await harness.tool('verify_pass', { run_id: run.run_id, from_number: run.from, code: spoken });
  const valid = (res.body as { valid?: boolean }).valid;
  run.steps.push({
    label: 'verify_pass',
    request_id: null,
    decision: null,
    final: null,
    reasons: [],
    events: [],
    propose_ms: null,
  });
  if (step.expect?.valid !== undefined)
    check(run, valid === step.expect.valid, `verify_pass: valid ${String(valid)}`);
}

async function propose(
  run: Run,
  p: ProposeStep,
  run_id = run.run_id,
): Promise<{ request_id: string | null; ms: number }> {
  const res = await run.harness.tool('propose_action', {
    run_id,
    ...(run.from ? { from_number: run.from } : {}),
    channel: run.scenario.caller.from === 'app_session' ? 'web' : 'phone',
    action: p.action,
    params: p.params,
    readback_confirmed: p.readback_confirmed,
    caller_quotes: p.caller_quotes ?? [],
  });
  run.propose_ms.push(res.ms);
  const body = res.body as { request_id?: string; status?: string };
  check(run, res.status === 200 && body.status === 'pending', `propose_action answered ${res.status}`);
  check(run, res.ms < PROPOSE_BUDGET_MS, `propose_action took ${res.ms} ms (budget ${PROPOSE_BUDGET_MS} ms)`);
  if (body.request_id) run.requests.push(body.request_id);
  return { request_id: body.request_id ?? null, ms: res.ms };
}

async function answer(run: Run, step: Step, request_id: string): Promise<void> {
  const a = step.confirm_answer;
  if (!a) return;
  const { harness } = run;
  if (a.channel === 'none') {
    await harness.advance(a.after_ms);
    if (!(await harness.fireTimeouts())) run.skipped.push('timeout: left to the Hub alarm (live mode)');
    await harness.settle();
    return;
  }
  await harness.advance(Math.min(a.after_ms, 59_000));
  const choice = a.answer ?? 'decline';
  if (a.channel === 'passkey') {
    const res = await harness.passkey(request_id, choice);
    if (res === false) run.skipped.push(`passkey ${choice}: not possible in ${harness.mode} mode`);
    else check(run, res.status === 200, `passkey ${choice} answered ${res.status}`);
  } else {
    const call = harness.outbound().find((o) => o.request_id === request_id);
    check(run, call !== undefined, 'the Confirm callback was never placed');
    if (call) {
      const res = await harness.tool('confirm_result', {
        run_id: call.execution_id,
        request_id,
        answer: choice,
        method: 'speech',
      });
      check(run, res.status === 200, `confirm_result answered ${res.status}`);
    }
  }
  await harness.settle();
}

async function expectations(
  run: Run,
  label: string,
  e: Expect,
  request_id: string | null,
  coreBefore: number,
  eventsBefore: number,
  run_id: string,
): Promise<StepReport> {
  const { harness } = run;
  const record = request_id ? await harness.request(request_id) : null;
  const at = `${label}`;
  check(run, record !== null, `${at}: no request recorded`);
  const events = eventNames(harness.events(run_id).slice(eventsBefore));
  const reasons = record?.decision.reasons ?? [];
  const report: StepReport = {
    label,
    request_id,
    decision: record?.decision.outcome ?? null,
    final: record?.final_outcome ?? null,
    reasons,
    events,
    propose_ms: null,
  };
  if (!record) return report;
  if (e.decision)
    check(
      run,
      record.decision.outcome === e.decision,
      `${at}: decision ${record.decision.outcome}, expected ${e.decision} (${reasons.join(', ')})`,
    );
  if (e.final)
    check(
      run,
      record.final_outcome === e.final,
      `${at}: final ${String(record.final_outcome)}, expected ${e.final}`,
    );
  for (const code of e.reasons_include ?? [])
    check(run, reasons.includes(code), `${at}: reasons lack ${code} (got ${reasons.join(', ')})`);
  const granted = harness
    .coreCalls()
    .slice(coreBefore)
    .filter((c) => c.granted && c.status === 200);
  if (e.core_called !== undefined)
    check(
      run,
      granted.length > 0 === e.core_called,
      `${at}: Aero Core ${granted.length > 0 ? 'was' : 'was not'} called`,
    );
  if (e.events) {
    const live = harness.mode === 'live' && e.events.includes('timeout') && !events.includes('timeout');
    if (live) run.skipped.push(`${at}: the timeout event comes from the Hub alarm later`);
    else
      check(
        run,
        events.join(',') === e.events.join(','),
        `${at}: events [${events.join(', ')}], expected [${e.events.join(', ')}]`,
      );
  }
  if (e.confirmation_channels)
    check(
      run,
      [...(record.confirm?.channels ?? [])].sort().join(',') ===
        [...e.confirmation_channels].sort().join(','),
      `${at}: confirmation channels [${record.confirm?.channels.join(', ') ?? ''}]`,
    );
  const aero = harness.messages('aero');
  if (aero === null && (e.alert_sent || e.step_up_offered === false))
    run.skipped.push(`${at}: app messages are not observable in ${harness.mode} mode`);
  if (e.alert_sent && aero)
    check(
      run,
      aero.some(
        (m) =>
          m.type === 'decision' &&
          m.decision.request_id === record.request_id &&
          (m.decision.final_outcome === 'deny' || m.decision.outcome === 'deny'),
      ),
      `${at}: the Aero app got no alert`,
    );
  if (e.step_up_offered === false) {
    check(run, record.decision.outcome !== 'step_up', `${at}: a step-up was offered`);
    if (aero)
      check(
        run,
        !aero.some((m) => m.type === 'confirm_request' && m.request_id === record.request_id),
        `${at}: a confirmation was sent`,
      );
  }
  if (e.handoff_created) {
    const { entries } = await harness.ledger();
    check(
      run,
      record.handoff_id !== null &&
        entries.some((x) => x.type === 'handoff' && x.ref_id === record.request_id),
      `${at}: no handoff`,
    );
  }
  return report;
}

/** "Rules every scenario also checks" (docs/SCENARIOS.md). */
async function rules(run: Run): Promise<void> {
  const { harness } = run;
  const { entries, head } = await harness.ledger();
  const verified = await verifyLedgerChain(entries, head ? { anchor: head } : {});
  check(run, verified.ok, `ledger chain does not verify (${JSON.stringify(verified)})`);
  for (const request_id of run.requests) {
    const types = entries.filter((e) => e.ref_id === request_id).map((e) => e.type);
    const order = types.filter((t) => CAUSAL.includes(t)).map((t) => CAUSAL.indexOf(t));
    // 'decided' appears twice for a step-up (the Gate, then the final outcome): compare first occurrences.
    const firsts = CAUSAL.map((t) => types.indexOf(t)).filter((i) => i >= 0);
    check(
      run,
      firsts.every((v, i) => i === 0 || v > (firsts[i - 1] ?? -1)),
      `${request_id}: ledger out of causal order (${types.join(' → ')})`,
    );
    check(
      run,
      order.length > 0 && types[0] === 'proposed',
      `${request_id}: ledger does not start with proposed`,
    );
  }
  const ungranted = harness.coreCalls().filter((c) => !c.granted);
  check(
    run,
    ungranted.length === run.directCalls,
    `Aero Core saw ${ungranted.length} request(s) without a grant`,
  );
  check(
    run,
    harness
      .coreCalls()
      .filter((c) => !c.granted)
      .every((c) => c.status === 401),
    'Aero Core accepted a request without a grant',
  );
  const logs = harness.logs();
  if (logs) {
    const numbers = Object.values(harness.numbers);
    const leaked = logs.filter((line) => numbers.some((n) => line.includes(n)) || maskNumbers(line) !== line);
    check(run, leaked.length === 0, `unmasked numbers in ${leaked.length} log line(s)`);
  }
}

async function runSteps(run: Run): Promise<void> {
  const { scenario, harness } = run;
  if (scenario.repeat && scenario.expect_sequence) {
    const step = scenario.steps[0];
    if (!step?.propose) return void run.failures.push('repeat needs one propose step');
    const decisions: (RequestRecord | null)[] = [];
    for (let i = 0; i < scenario.repeat; i++) {
      if (i > 0) await harness.advance(scenario.interval_ms ?? 0);
      // Invariant 7: the same (run_id, params_hash) is one request for a whole call, so each repeat is its own call
      // (new run_id, same registered number), found by the calling number.
      if (i > 0) {
        run.run_id = harness.newRunId();
        await identify(run, scenario.region);
      }
      const { request_id } = await propose(run, step.propose);
      await harness.settle();
      decisions.push(request_id ? await harness.request(request_id) : null);
    }
    for (const rule of scenario.expect_sequence) {
      const indexes = rule.index
        ? [rule.index]
        : Array.from(
            { length: scenario.repeat - (rule.from_index ?? 1) + 1 },
            (_, i) => (rule.from_index ?? 1) + i,
          );
      for (const index of indexes) {
        const record = decisions[index - 1];
        check(
          run,
          record?.decision.outcome === rule.decision,
          `#${index}: decision ${String(record?.decision.outcome)}, expected ${rule.decision}`,
        );
        for (const code of rule.reasons_include ?? [])
          check(run, record?.decision.reasons.includes(code) === true, `#${index}: reasons lack ${code}`);
      }
    }
    run.steps.push(
      ...decisions.map((r, i) => ({
        label: `#${i + 1}`,
        request_id: r?.request_id ?? null,
        decision: r?.decision.outcome ?? null,
        final: r?.final_outcome ?? null,
        reasons: r?.decision.reasons ?? [],
        events: [],
        propose_ms: run.propose_ms[i] ?? null,
      })),
    );
    return;
  }
  for (const [i, step] of scenario.steps.entries()) {
    if (step.verify_pass) {
      await verifyPassStep(run, step);
      continue;
    }
    if (step.direct_core_call) {
      run.directCalls += 1;
      const res = await harness.directCore(step.direct_core_call.path);
      const code = (res.body as { error?: { code?: string } }).error?.code;
      if (step.expect?.http_status !== undefined)
        check(
          run,
          res.status === step.expect.http_status,
          `direct ${step.direct_core_call.path}: ${res.status}`,
        );
      if (step.expect?.reason)
        check(run, code === step.expect.reason, `direct ${step.direct_core_call.path}: ${String(code)}`);
      continue;
    }
    if (!step.propose) {
      run.failures.push(`step ${i + 1}: nothing to do`);
      continue;
    }
    const coreBefore = harness.coreCalls().length;
    const eventsBefore = harness.events(run.run_id).length;
    const { request_id, ms } = await propose(run, step.propose);
    await harness.settle();
    if (request_id) await answer(run, step, request_id);
    const report = await expectations(
      run,
      `step ${i + 1} (${step.propose.action})`,
      step.expect ?? {},
      request_id,
      coreBefore,
      eventsBefore,
      run.run_id,
    );
    report.propose_ms = ms;
    run.steps.push(report);
  }
}

/** Play one scenario through the harness. Never throws: an error is a failure in the result. */
export async function runScenario(
  spec: ScenarioSpec,
  scenario: Scenario,
  harness: Harness,
): Promise<ScenarioResult> {
  const from = scenario.caller.from === 'app_session' ? null : harness.numbers[scenario.caller.from];
  const run: Run = {
    scenario,
    spec,
    harness,
    run_id: '',
    from,
    failures: [],
    skipped: [],
    steps: [],
    propose_ms: [],
    requests: [],
    directCalls: 0,
  };
  try {
    const browser = scenario.caller.from === 'app_session';
    const web = browser ? await harness.webCall(scenario.region) : null;
    if (browser && web === null) {
      run.skipped.push(`browser call: not possible in ${harness.mode} mode`);
      return result(run);
    }
    run.run_id = web ?? harness.newRunId();
    await identify(run, scenario.region);
    await runSteps(run);
    await compare(run);
    await rules(run);
  } catch (err) {
    run.failures.push(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result(run);
}

/** Scenario 10: the same request on a fresh call in the other region decides by that region's pack. */
async function compare(run: Run): Promise<void> {
  const { scenario, harness } = run;
  const step = scenario.compare_step;
  const region = scenario.compare_in_region;
  if (!step?.propose || !region) return;
  const run_id = scenario.caller.from === 'app_session' ? await harness.webCall(region) : harness.newRunId();
  if (run_id === null) {
    run.skipped.push(`compare in ${region}: no browser call in ${harness.mode} mode`);
    return;
  }
  const coreBefore = harness.coreCalls().length;
  const { request_id } = await propose(run, step.propose, run_id);
  await harness.settle();
  run.steps.push(
    await expectations(run, `compare in ${region}`, step.expect ?? {}, request_id, coreBefore, 0, run_id),
  );
}

function result(run: Run): ScenarioResult {
  const { scenario } = run;
  return {
    id: scenario.id,
    title: scenario.title,
    passed: run.failures.length === 0,
    failures: run.failures,
    skipped: run.skipped,
    steps: run.steps,
    propose_ms: run.propose_ms,
    ungranted_writes: run.harness.coreCalls().filter((c) => !c.granted && c.status < 400).length,
  };
}
