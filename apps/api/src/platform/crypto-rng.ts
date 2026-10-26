import type { Rng } from '@halyn/shared';

/** The Worker's randomness: WebCrypto. The only place in the API that calls getRandomValues (pure modules take an Rng). */
export const cryptoRng: Rng = {
  bytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
};
