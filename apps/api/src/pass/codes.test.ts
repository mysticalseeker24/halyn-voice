import { fixedClock, HalynError, sha256Hex } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { scriptedRng, seededRng } from '../../test/fixtures/crypto';
import { ASSISTANT_NUMBER, CLOCK, issuedPass, NOW, OTHER_NUMBER, PEPPER } from '../../test/fixtures/pass';
import { mintPassCode, type PassCodeRow, PassCodeRowSchema, type PassRow, verifyPassCode } from './index';

async function minted(rowPatch: Partial<PassRow> = {}, rng = seededRng(11)) {
  const { row } = await issuedPass(rowPatch);
  const result = await mintPassCode(
    { pass: row, calling_number: ASSISTANT_NUMBER, pepper: PEPPER },
    CLOCK,
    rng,
  );
  if (!result.ok) throw new Error(`mint refused: ${result.reason}`);
  return { row, ...result };
}

const verify = (
  code: string,
  pass: PassRow,
  codes: PassCodeRow[],
  from = ASSISTANT_NUMBER,
  at = NOW + 10_000,
) =>
  verifyPassCode(
    { tenant_id: 'ten_aero', code, from_number: from, candidates: [{ pass, codes }], pepper: PEPPER },
    fixedClock(at),
  );

describe('mintPassCode', () => {
  it('mints 6 digits, stores only SHA-256(pepper ‖ code), bound to the number, valid 5 minutes', async () => {
    const { row, code, record } = await minted();
    expect(code).toMatch(/^\d{6}$/);
    expect(PassCodeRowSchema.parse(record)).toEqual(record);
    expect(record).toEqual({
      id: record.id,
      pass_id: row.id,
      code_hash: await sha256Hex(PEPPER + code),
      bound_number: ASSISTANT_NUMBER,
      expires_at: new Date(NOW + 300_000).toISOString(),
      used_at: null,
    });
    expect(JSON.stringify(record)).not.toContain(code);
  });

  it('draws digits by rejection sampling (no modulo bias)', async () => {
    // 2^32 − 1 and 4 294 000 000 are at or above the largest multiple of 10^6 below 2^32, so both are redrawn.
    const { code } = await minted({}, scriptedRng([4_294_967_295, 4_294_000_000, 123_456]));
    expect(code).toBe('123456');
    const { code: top } = await minted({}, scriptedRng([4_293_999_999]));
    expect(top).toBe('999999');
    const { code: low } = await minted({}, scriptedRng([7]));
    expect(low).toBe('000007');
  });

  it('fails closed when the rng returns the wrong number of bytes', async () => {
    const { row } = await issuedPass();
    await expect(
      mintPassCode({ pass: row, calling_number: ASSISTANT_NUMBER, pepper: PEPPER }, CLOCK, {
        bytes: () => new Uint8Array(2),
      }),
    ).rejects.toThrow(HalynError);
  });

  it('fails closed when the rng never yields a usable value', async () => {
    const { row } = await issuedPass();
    await expect(
      mintPassCode(
        { pass: row, calling_number: ASSISTANT_NUMBER, pepper: PEPPER },
        CLOCK,
        scriptedRng([4_294_967_295]),
      ),
    ).rejects.toThrow(HalynError);
  });

  it.each<[string, Partial<PassRow>, string, string]>([
    ['a number the Pass does not list', {}, OTHER_NUMBER, 'wrong_number'],
    [
      'a revoked Pass',
      { status: 'revoked', revoked_at: new Date(NOW).toISOString() },
      ASSISTANT_NUMBER,
      'revoked',
    ],
    ['a locked Pass', { status: 'locked', failures: 5 }, ASSISTANT_NUMBER, 'locked'],
    ['an expired Pass', { expires_at: new Date(NOW).toISOString() }, ASSISTANT_NUMBER, 'pass_expired'],
  ])('refuses %s', async (_, patch, number, reason) => {
    const { row } = await issuedPass(patch);
    const result = await mintPassCode(
      { pass: row, calling_number: number, pepper: PEPPER },
      CLOCK,
      seededRng(1),
    );
    expect(result).toEqual({ ok: false, reason });
  });

  it('fails closed on a short pepper or a malformed row', async () => {
    const { row } = await issuedPass();
    await expect(
      mintPassCode({ pass: row, calling_number: ASSISTANT_NUMBER, pepper: 'short' }, CLOCK, seededRng(1)),
    ).rejects.toThrow(HalynError);
    await expect(
      mintPassCode(
        { pass: { ...row, failures: -1 }, calling_number: ASSISTANT_NUMBER, pepper: PEPPER },
        CLOCK,
        seededRng(1),
      ),
    ).rejects.toThrow(HalynError);
  });
});

describe('verifyPassCode', () => {
  it('accepts the right code once, from the bound number, and marks it used', async () => {
    const { row, code, record } = await minted();
    const result = await verify(code, row, [record]);
    expect(result).toEqual({
      valid: true,
      pass_id: row.id,
      scopes: row.scopes,
      updates: { codes: [{ id: record.id, used_at: new Date(NOW + 10_000).toISOString() }], passes: [] },
    });
  });

  it('accepts the code the way an agent hears it ("4 7 2 9 1 5")', async () => {
    const { row, code, record } = await minted();
    expect((await verify(code.split('').join(' '), row, [record])).valid).toBe(true);
    expect((await verify(`${code.slice(0, 3)}-${code.slice(3)}`, row, [record])).valid).toBe(true);
  });

  describe('security', () => {
    it('a replayed code → invalid (replayed) and counts as a failure', async () => {
      const { row, code, record } = await minted();
      const used = { ...record, used_at: new Date(NOW + 1000).toISOString() };
      expect(await verify(code, row, [used])).toEqual({
        valid: false,
        reason: 'replayed',
        updates: { codes: [], passes: [{ id: row.id, failures: 1, status: 'active' }] },
      });
    });

    it('an expired code (5 minutes after minting) → invalid (expired)', async () => {
      const { row, code, record } = await minted();
      expect((await verify(code, row, [record], ASSISTANT_NUMBER, NOW + 299_999)).valid).toBe(true);
      expect(await verify(code, row, [record], ASSISTANT_NUMBER, NOW + 300_000)).toMatchObject({
        valid: false,
        reason: 'expired',
      });
    });

    it('the right code from the wrong number → invalid (wrong_number)', async () => {
      const { row, code, record } = await minted();
      expect(await verify(code, row, [record], OTHER_NUMBER)).toMatchObject({
        valid: false,
        reason: 'wrong_number',
      });
      // Bound to a number the Pass no longer lists (row edited after minting): still refused.
      const narrowed = { ...row, assistant_numbers: [OTHER_NUMBER] };
      expect(await verify(code, narrowed, [record])).toMatchObject({ valid: false, reason: 'wrong_number' });
    });

    it('the 5th failure locks the Pass, and a locked Pass refuses even a fresh correct code', async () => {
      const { row, code, record } = await minted({ failures: 4 });
      const fifth = await verify('000000' === code ? '111111' : '000000', row, [record]);
      expect(fifth).toEqual({
        valid: false,
        reason: 'no_match',
        updates: { codes: [], passes: [{ id: row.id, failures: 5, status: 'locked' }] },
      });
      const locked = { ...row, failures: 5, status: 'locked' as const };
      expect(await verify(code, locked, [record])).toMatchObject({ valid: false, reason: 'locked' });
    });

    it('a revoked Pass refuses a correct, fresh code', async () => {
      const { row, code, record } = await minted();
      const revoked = { ...row, status: 'revoked' as const, revoked_at: new Date(NOW + 5000).toISOString() };
      expect(await verify(code, revoked, [record])).toMatchObject({ valid: false, reason: 'revoked' });
    });

    it('an expired Pass refuses a correct code', async () => {
      const { row, code, record } = await minted();
      const result = await verify(code, row, [record], ASSISTANT_NUMBER, Date.parse(row.expires_at));
      expect(result).toMatchObject({ valid: false, reason: 'pass_expired' });
    });

    it('a wrong code counts a failure against every Pass listing the calling number', async () => {
      const a = await minted();
      const b = await minted({ failures: 2 });
      const result = await verifyPassCode(
        {
          tenant_id: 'ten_aero',
          code: a.code === '123123' ? '321321' : '123123',
          from_number: ASSISTANT_NUMBER,
          candidates: [
            { pass: a.row, codes: [a.record] },
            { pass: b.row, codes: [b.record] },
          ],
          pepper: PEPPER,
        },
        fixedClock(NOW + 10_000),
      );
      expect(result).toEqual({
        valid: false,
        reason: 'no_match',
        updates: {
          codes: [],
          passes: [
            { id: a.row.id, failures: 1, status: 'active' },
            { id: b.row.id, failures: 3, status: 'active' },
          ],
        },
      });
    });

    it('a malformed code is a no_match failure; no candidates means nothing to update', async () => {
      const { row, record } = await minted();
      expect(await verify('12ab56', row, [record])).toMatchObject({ valid: false, reason: 'no_match' });
      expect(
        await verifyPassCode(
          {
            tenant_id: 'ten_aero',
            code: '123456',
            from_number: OTHER_NUMBER,
            candidates: [],
            pepper: PEPPER,
          },
          fixedClock(NOW),
        ),
      ).toEqual({ valid: false, reason: 'no_match', updates: { codes: [], passes: [] } });
    });

    it('a code hashed with another pepper does not verify', async () => {
      const { row, code, record } = await minted();
      const result = await verifyPassCode(
        {
          tenant_id: 'ten_aero',
          code,
          from_number: ASSISTANT_NUMBER,
          candidates: [{ pass: row, codes: [record] }],
          pepper: `${PEPPER}x`,
        },
        fixedClock(NOW + 10_000),
      );
      expect(result).toMatchObject({ valid: false, reason: 'no_match' });
    });
  });

  it('fails closed on a short pepper', async () => {
    const { row, code, record } = await minted();
    await expect(
      verifyPassCode(
        {
          tenant_id: 'ten_aero',
          code,
          from_number: ASSISTANT_NUMBER,
          candidates: [{ pass: row, codes: [record] }],
          pepper: 'x',
        },
        CLOCK,
      ),
    ).rejects.toThrow(HalynError);
  });
});
