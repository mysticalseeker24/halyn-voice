import { fixedClock, HalynError, PASS_CODE } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../test/fixtures/crypto';
import { ASSISTANT_NUMBER, CLOCK, issuedPass, NOW, OTHER_NUMBER, PEPPER } from '../../test/fixtures/pass';
import {
  drawPassCode,
  mintPassCode,
  type PassCandidate,
  type PassRow,
  revokePass,
  verifyPassCode,
} from './index';

// Test-engineer pass (Step 3): docs/PASS.md binds a code to (pass_id, tenant, calling number), allows one use, and
// locks the Pass after five failures. These attack each binding with more than one Pass in play.

const TENANT = 'ten_aero';
const PASS_A = 'pass_01JBK2W4Z8Q3N5R7T9V1X3Z5A1';
const PASS_B = 'pass_01JBK2W4Z8Q3N5R7T9V1X3Z5B2';
const LATER = fixedClock(NOW + 10_000);

async function mintedFor(id: string, patch: Partial<PassRow> = {}, seed = 11) {
  const { row } = await issuedPass({ id, ...patch });
  const result = await mintPassCode(
    { pass: row, calling_number: ASSISTANT_NUMBER, pepper: PEPPER },
    CLOCK,
    seededRng(seed),
  );
  if (!result.ok) throw new Error(`mint refused: ${result.reason}`);
  return { row, code: result.code, record: result.record };
}

const verify = (code: string, candidates: PassCandidate[], from = ASSISTANT_NUMBER, tenant_id = TENANT) =>
  verifyPassCode({ tenant_id, code, from_number: from, candidates, pepper: PEPPER }, LATER);

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

describe('several Passes on one number', () => {
  it('a code verifies only for its own Pass and costs the other Pass nothing', async () => {
    const a = await mintedFor(PASS_A, {}, 11);
    const b = await mintedFor(PASS_B, {}, 12);
    const result = await verify(b.code, [
      { pass: a.row, codes: [a.record] },
      { pass: b.row, codes: [b.record] },
    ]);
    expect(result).toMatchObject({ valid: true, pass_id: PASS_B, updates: { passes: [] } });
  });

  it("a revoked Pass's code fails on that Pass only, even when another Pass lists the number", async () => {
    const a = await mintedFor(PASS_A, {}, 11);
    const b = await mintedFor(PASS_B, {}, 12);
    const revokedA = revokePass(a.row, CLOCK);
    const result = await verify(a.code, [
      { pass: revokedA, codes: [a.record] },
      { pass: b.row, codes: [b.record] },
    ]);
    expect(result).toEqual({
      valid: false,
      reason: 'revoked',
      updates: { codes: [], passes: [{ id: PASS_A, failures: 1, status: 'revoked' }] },
    });
  });

  it("one Pass's code is not accepted for another Pass", async () => {
    const a = await mintedFor(PASS_A, {}, 11);
    const b = await mintedFor(PASS_B, {}, 12);
    expect(await verify(a.code, [{ pass: b.row, codes: [b.record] }])).toMatchObject({
      valid: false,
      reason: 'no_match',
      updates: { passes: [{ id: PASS_B, failures: 1, status: 'active' }] },
    });
  });
});

describe('failure counting and the lock', () => {
  // Minting needs an active Pass, so these mint first and lock the row afterwards (as five failures would).
  const lock = (row: PassRow): PassRow => ({ ...row, failures: 5, status: 'locked' });

  it('failures keep counting on a Pass that is already locked; it stays locked', async () => {
    const a = await mintedFor(PASS_A);
    expect(await verify(wrongCode(a.code), [{ pass: lock(a.row), codes: [a.record] }])).toEqual({
      valid: false,
      reason: 'no_match',
      updates: { codes: [], passes: [{ id: PASS_A, failures: 6, status: 'locked' }] },
    });
  });

  it('after 4 failures the right code still works, without resetting the count (PASS.md: cumulative)', async () => {
    const a = await mintedFor(PASS_A, { failures: 4 });
    const ok = await verify(a.code, [{ pass: a.row, codes: [a.record] }]);
    expect(ok).toMatchObject({ valid: true, updates: { passes: [] } });
    // The next failure is the fifth and locks the Pass.
    const used = { ...a.record, used_at: new Date(NOW + 10_000).toISOString() };
    expect(await verify(wrongCode(a.code), [{ pass: a.row, codes: [used] }])).toMatchObject({
      valid: false,
      updates: { passes: [{ id: PASS_A, failures: 5, status: 'locked' }] },
    });
  });

  it('a locked Pass never verifies, even with its own fresh, correct code from the bound number', async () => {
    const a = await mintedFor(PASS_A);
    expect(await verify(a.code, [{ pass: lock(a.row), codes: [a.record] }])).toEqual({
      valid: false,
      reason: 'locked',
      updates: { codes: [], passes: [{ id: PASS_A, failures: 6, status: 'locked' }] },
    });
  });
});

describe('number and tenant binding', () => {
  it('the bound number written another way (spaces) is a different number: wrong_number, and it counts', async () => {
    const a = await mintedFor(PASS_A);
    expect(await verify(a.code, [{ pass: a.row, codes: [a.record] }], '+91 80653 56379')).toEqual({
      valid: false,
      reason: 'wrong_number',
      updates: { codes: [], passes: [{ id: PASS_A, failures: 1, status: 'active' }] },
    });
  });

  it('a number the Pass no longer lists cannot use a code minted while it did', async () => {
    const a = await mintedFor(PASS_A);
    const relisted = { ...a.row, assistant_numbers: [OTHER_NUMBER] };
    expect(await verify(a.code, [{ pass: relisted, codes: [a.record] }])).toMatchObject({
      valid: false,
      reason: 'wrong_number',
    });
  });

  it('a candidate Pass from another tenant fails closed (invariant 8: the caller must never load it)', async () => {
    const a = await mintedFor(PASS_A);
    await expect(
      verify(a.code, [{ pass: a.row, codes: [a.record] }], ASSISTANT_NUMBER, 'ten_other'),
    ).rejects.toThrow(HalynError);
  });

  it('a malformed tenant id fails closed before any row is read', async () => {
    const a = await mintedFor(PASS_A);
    await expect(
      verify(a.code, [{ pass: a.row, codes: [a.record] }], ASSISTANT_NUMBER, 'aero'),
    ).rejects.toThrow(HalynError);
  });

  it('a Pass row whose scopes include a critical action never verifies (invariant 5 at verify time)', async () => {
    const a = await mintedFor(PASS_A);
    const tampered = { ...a.row, scopes: [...a.row.scopes, { action: 'transfer.new_payee' as const }] };
    await expect(verify(a.code, [{ pass: tampered, codes: [a.record] }])).rejects.toThrow(HalynError);
  });
});

describe('mint refusals', () => {
  it('revoke, then mint: refused', async () => {
    const { row } = await issuedPass({ id: PASS_A });
    const revoked = revokePass(row, CLOCK);
    expect(
      await mintPassCode(
        { pass: revoked, calling_number: ASSISTANT_NUMBER, pepper: PEPPER },
        CLOCK,
        seededRng(1),
      ),
    ).toEqual({ ok: false, reason: 'revoked' });
  });
});

describe('code distribution', () => {
  it('100 000 seeded draws: every digit position is uniform (chi-square, generous bound)', () => {
    const rng = seededRng(20261026);
    const counts = Array.from({ length: PASS_CODE.digits }, () => new Array<number>(10).fill(0));
    const N = 100_000;
    for (let n = 0; n < N; n++) {
      const code = drawPassCode(rng);
      expect(code).toMatch(/^\d{6}$/);
      for (let p = 0; p < PASS_CODE.digits; p++) {
        const row = counts[p] ?? [];
        const d = Number(code[p]);
        row[d] = (row[d] ?? 0) + 1;
      }
    }
    const expected = N / 10;
    for (const row of counts) {
      const chi2 = row.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
      // 9 degrees of freedom: p = 0.001 is at 27.9. A biased draw (e.g. modulo without rejection) lands far above.
      expect(chi2).toBeLessThan(40);
    }
  });
});
