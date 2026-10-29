import { ErrorEnvelopeSchema } from '@halyn/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, REGISTERED } from '../../test/fixtures/app';

// Step 16 drills: the Hub unreachable on every tool path (invariant 2), and propose_action's warm-path latency.
// The Worker dying after an approval is the sweep's job (hub/reconcile.test.ts); Aero Core down is execute.test.ts.

const RUN = '0b5c7a4e-3333-4444-8555-666677778888';
let h: AppHarness;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

const freeze = (run_id = RUN) => ({
  run_id,
  from_number: REGISTERED,
  channel: 'phone',
  action: 'card.freeze',
  params: { card_last4: '8812' },
  readback_confirmed: true,
  caller_quotes: ['Mera card kho gaya hai'],
});

/** A Durable Object namespace whose every call fails, as when the Hub is unreachable or resetting. */
function hubDown(): void {
  const dead = new Proxy(
    {},
    { get: () => () => Promise.reject(new Error('Durable Object is overloaded or unreachable')) },
  );
  Object.assign(h.env, { HUB: { getByName: () => dead, idFromName: () => ({}), get: () => dead } });
}

async function failedClosed(res: Response): Promise<void> {
  expect(res.status).toBe(500);
  const { error } = ErrorEnvelopeSchema.parse(await res.json());
  expect(error.code).toBe('E_FAIL_CLOSED');
  // The agent reads this out in its own words: polite, and it says nothing changed.
  expect(error.message).toBe('The request failed closed; nothing was changed.');
}

describe('fail-closed drill: the Hub is down', () => {
  it('propose_action → E_FAIL_CLOSED, nothing executed, no event claims success', async () => {
    hubDown();
    await failedClosed(await h.tool('propose_action', freeze()));
    await h.settle();
    expect(h.aero.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(h.bolna.events.get(RUN) ?? []).toEqual([]);
  });

  it('lookup_customer and check_decision → E_FAIL_CLOSED, never a customer or a decision', async () => {
    const { request_id } = (await (await h.tool('propose_action', freeze())).json()) as {
      request_id: string;
    };
    hubDown();
    await failedClosed(await h.tool('lookup_customer', { run_id: RUN, from_number: REGISTERED }));
    await failedClosed(await h.tool('check_decision', { run_id: RUN, request_id }));
  });
});

describe('performance', () => {
  it('propose_action p95 < 300 ms over 50 warm calls', async () => {
    await h.tool('propose_action', { ...freeze('0b5c7a4e-3333-4444-8555-000000000000') });
    await h.settle();
    const times: number[] = [];
    for (let i = 1; i <= 50; i++) {
      const run = `0b5c7a4e-3333-4444-8555-${String(i).padStart(12, '0')}`;
      const started = performance.now();
      const res = await h.tool('propose_action', freeze(run));
      times.push(performance.now() - started);
      expect(res.status).toBe(200);
      await h.settle();
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(300);
    // 50 calls, each settled before the next: slow under pnpm verify's parallel load, so its own budget (only the
    // propose_action calls themselves are timed).
  }, 120_000);
});
