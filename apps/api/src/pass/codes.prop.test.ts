import fc from 'fast-check';
import { fixedClock } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../test/fixtures/crypto';
import { ASSISTANT_NUMBER, CLOCK, issuedPass, NOW, PEPPER } from '../../test/fixtures/pass';
import { mintPassCode, verifyPassCode } from './index';

describe('Pass code properties', () => {
  it('every minted code is 6 digits and the first digit is spread evenly (fixed-seed sample)', async () => {
    const { row } = await issuedPass();
    const rng = seededRng(2026);
    const counts = new Array<number>(10).fill(0);
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const result = await mintPassCode(
        { pass: row, calling_number: ASSISTANT_NUMBER, pepper: PEPPER },
        CLOCK,
        rng,
      );
      if (!result.ok) throw new Error('mint refused');
      expect(result.code).toMatch(/^\d{6}$/);
      counts[Number(result.code[0])]! += 1;
    }
    // Expected 300 per digit; a biased draw (e.g. modulo) would skew this well past ±25%.
    for (const c of counts) {
      expect(c).toBeGreaterThan(225);
      expect(c).toBeLessThan(375);
    }
  });

  it('a freshly minted code verifies exactly once from its bound number', async () => {
    const { row } = await issuedPass();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2 ** 31 }),
        fc.integer({ min: 0, max: 299_999 }),
        async (seed, after) => {
          const minted = await mintPassCode(
            { pass: row, calling_number: ASSISTANT_NUMBER, pepper: PEPPER },
            CLOCK,
            seededRng(seed),
          );
          if (!minted.ok) throw new Error('mint refused');
          const at = fixedClock(NOW + after);
          const first = await verifyPassCode(
            {
              tenant_id: 'ten_aero',
              code: minted.code,
              from_number: ASSISTANT_NUMBER,
              candidates: [{ pass: row, codes: [minted.record] }],
              pepper: PEPPER,
            },
            at,
          );
          expect(first.valid).toBe(true);
          const used = { ...minted.record, used_at: first.updates.codes[0]?.used_at ?? null };
          const second = await verifyPassCode(
            {
              tenant_id: 'ten_aero',
              code: minted.code,
              from_number: ASSISTANT_NUMBER,
              candidates: [{ pass: row, codes: [used] }],
              pepper: PEPPER,
            },
            at,
          );
          expect(second).toMatchObject({ valid: false, reason: 'replayed' });
        },
      ),
      { seed: 3007, numRuns: 100 },
    );
  });
});
