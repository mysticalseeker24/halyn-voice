import type { Clock } from '@halyn/shared';

/** The Worker's time: the only place outside the Hub that reads the system clock (pure modules take a Clock). */
export const systemClock: Clock = { nowMs: () => Date.now() };
