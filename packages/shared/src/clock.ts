import { HalynError } from './errors';

/** Time source injected into pure modules, which never read the system clock. Milliseconds since the epoch. */
export interface Clock {
  nowMs(): number;
}

/** A clock frozen at one instant, for tests and replays. */
export function fixedClock(ms: number): Clock {
  if (!Number.isSafeInteger(ms) || ms < 0)
    throw new HalynError('E_FAIL_CLOSED', `fixedClock: expected epoch milliseconds, got ${String(ms)}`);
  return { nowMs: () => ms };
}
