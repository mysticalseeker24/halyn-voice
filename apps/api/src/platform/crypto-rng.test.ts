import { describe, expect, it } from 'vitest';
import { cryptoRng } from './crypto-rng';

describe('cryptoRng', () => {
  it('returns the requested number of random bytes', () => {
    const a = cryptoRng.bytes(16);
    const b = cryptoRng.bytes(16);
    expect(a).toHaveLength(16);
    expect([...a]).not.toEqual([...b]);
    expect(cryptoRng.bytes(0)).toHaveLength(0);
  });
});
