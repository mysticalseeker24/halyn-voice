import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

// Placeholder property test: proves fast-check runs under Vitest here. Real properties
// (canonical JSON ordering, money round-trips) arrive in Step 1.
describe('fast-check wiring', () => {
  it('runs a property with shrinking and a fixed seed', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        expect([...xs].reverse().reverse()).toEqual(xs);
      }),
      { seed: 20261025 },
    );
  });
});
