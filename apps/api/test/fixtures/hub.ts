import type { Clock, LedgerEntry } from '@halyn/shared';
import type { LedgerSink } from '../../src/hub/ledger-sink';

// Test seams for the Hub (set on the Durable Object instance through runInDurableObject).

/**
 * A clock the test moves by hand. It starts a day ahead of real time, so every alarm the Hub schedules from it lies in
 * the real future and never fires on its own mid-test; tests run alarms explicitly with runDurableObjectAlarm.
 */
export function movableClock(
  startMs = Date.now() + 24 * 60 * 60 * 1000,
): Clock & { advance(ms: number): void } {
  let now = startMs;
  return {
    nowMs: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

/** A LedgerSink that records what it was given, and can be told to fail the next N calls. */
export function recordingSink(): LedgerSink & { batches: LedgerEntry[][]; failNext: number } {
  const sink = {
    batches: [] as LedgerEntry[][],
    failNext: 0,
    async persist(_tenant: string, entries: readonly LedgerEntry[]) {
      if (sink.failNext > 0) {
        sink.failNext -= 1;
        throw new Error('sink down');
      }
      sink.batches.push([...entries]);
    },
  };
  return sink;
}
