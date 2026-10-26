import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock';
import { HalynError } from './errors';

describe('fixedClock', () => {
  it('always returns the instant it was built with', () => {
    const clock = fixedClock(1761400000000);
    expect(clock.nowMs()).toBe(1761400000000);
    expect(clock.nowMs()).toBe(1761400000000);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed on %s',
    (ms) => {
      expect(() => fixedClock(ms)).toThrow(HalynError);
    },
  );
});
