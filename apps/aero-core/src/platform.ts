import type { Clock, Rng } from '@halyn/shared';

// The Worker's time and randomness. Everything else takes them as inputs, so tests can fix both.

export const systemClock: Clock = { nowMs: () => Date.now() };

/** WebCrypto randomness: the only getRandomValues call in Aero Core. */
export const cryptoRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
