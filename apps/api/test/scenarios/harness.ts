// The runner's Harness over the Miniflare app (test/fixtures/app.ts): real tools, Gate, Pass, Hub, ledger and Aero
// Core; Bolna is a recorder, the customer's answers go through the real passkey and confirm_result routes, and time
// is the shared movable clock (the 60 s timeout is the Hub's real alarm, fired on demand).
import type { WsMessage } from '@halyn/shared';
import { CORE_ORIGIN } from '../../src/core-client/client';
import { uuidFrom } from '../../src/test-runner/live';
import type { Harness } from '../../src/test-runner/runner';
import {
  ASSISTANT,
  type AppHarness,
  appHarness,
  REGISTERED,
  tick,
  UNKNOWN_AI,
  UNREGISTERED,
} from '../fixtures/app';
import type { SoftPasskey } from '../fixtures/webauthn';

export interface ScenarioHarness extends Harness {
  app: AppHarness;
  close(): void;
}

export async function scenarioHarness(): Promise<ScenarioHarness> {
  // Coaching layer 2 is on (ADR-024) with a Sarvam that finds nothing: every outcome must still match the spec.
  const app = await appHarness({
    sarvam: async () =>
      Response.json({ choices: [{ message: { content: '{"probability": 0.05, "cues": []}' } }] }),
  });
  const passkey: SoftPasskey = await app.registerPasskey();
  const aero = await app.listen('aero');
  const stage = await app.listen('stage');
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  return {
    app,
    mode: 'test',
    numbers: {
      registered: REGISTERED,
      unregistered: UNREGISTERED,
      assistant: ASSISTANT,
      unknown_ai: UNKNOWN_AI,
    },
    newRunId: () => uuidFrom(app.rng),
    async tool(name, body) {
      const started = Date.now();
      const res = await app.tool(name, body);
      const ms = Date.now() - started;
      return { status: res.status, body: await res.json().catch(() => null), ms };
    },
    async settle() {
      await app.settle();
      await tick();
    },
    async advance(ms) {
      app.clock.advance(ms);
    },
    async fireTimeouts() {
      await app.fireAlarm();
      await tick();
      return true;
    },
    async passkey(request_id, answer) {
      if (answer === 'approve') return { status: (await app.approve(request_id, passkey)).status };
      const res = await app.web(`/web/approvals/${request_id}/decline`, {}, await app.customerToken());
      return { status: res.status };
    },
    passToken: (name) => (name === 'valid_view_freeze_emi' ? app.passToken : null),
    events: (run_id) => app.bolna.events.get(run_id) ?? [],
    outbound: () => app.bolna.calls.map((c) => ({ request_id: c.request_id, execution_id: c.execution_id })),
    coreCalls: () => app.aero.calls,
    async directCore(path) {
      const res = await app.aero.transport(
        new Request(`${CORE_ORIGIN}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amount_minor: 4500000,
            currency: 'INR',
            payee_account_last4: '4471',
            payee_ifsc: 'AERO0000001',
          }),
        }),
      );
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    request: (request_id) => app.hub.requestState(request_id),
    async ledger() {
      return { entries: await app.ledger(), head: await app.hub.ledgerHead() };
    },
    messages: (role): WsMessage[] => (role === 'aero' ? aero : stage),
    logs: () => logs,
    close() {
      console.log = original;
    },
  };
}
