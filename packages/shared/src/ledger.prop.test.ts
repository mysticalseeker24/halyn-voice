import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, LEDGER_ENTRY_TYPES, type LedgerEntry, ledgerHash, verifyLedgerChain } from './ledger';

// Invariant 6: GET /ledger/verify must detect any edited row. Here: any single-character change to any entry.

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);

const entryInput = fc.record({
  type: fc.constantFrom(...LEDGER_ENTRY_TYPES),
  ref_id: fc.stringMatching(/^[a-z]{2,5}_[A-Za-z0-9]{1,12}$/),
  payload: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 6 }),
    fc.oneof(fc.integer(), fc.string({ maxLength: 10 }), fc.boolean(), fc.constant(null)),
    { maxKeys: 4 },
  ),
  gap_ms: fc.integer({ min: 0, max: 60_000 }),
});

async function build(
  inputs: { type: LedgerEntry['type']; ref_id: string; payload: Record<string, unknown>; gap_ms: number }[],
) {
  const out: LedgerEntry[] = [];
  let prev = GENESIS_HASH;
  let t = T0;
  for (const [i, input] of inputs.entries()) {
    t += input.gap_ms;
    const body = {
      seq: i + 1,
      tenant_id: 'ten_aero',
      type: input.type,
      ref_id: input.ref_id,
      payload: input.payload as LedgerEntry['payload'],
      created_at: new Date(t).toISOString(),
    };
    const hash = await ledgerHash(prev, body);
    out.push({ ...body, prev_hash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('ledger tamper detection (property)', () => {
  it('any single-character change to any entry is detected at that entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(entryInput, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.nat(),
        fc.integer({ min: 32, max: 126 }),
        async (inputs, pickEntry, pickChar, replacement) => {
          const entries = await build(inputs);
          const index = pickEntry % entries.length;
          const text = JSON.stringify(entries[index]);
          const at = pickChar % text.length;
          const char = String.fromCharCode(replacement);
          fc.pre(text[at] !== char);
          let mutated: unknown;
          try {
            mutated = JSON.parse(text.slice(0, at) + char + text.slice(at + 1));
          } catch {
            fc.pre(false);
          }
          const tampered = entries.map((e, i) => (i === index ? mutated : e));
          const result = await verifyLedgerChain(tampered);
          expect(result).toEqual({ ok: false, entries: entries.length, first_bad_seq: index + 1 });
        },
      ),
      { seed: 3005, numRuns: 400 },
    );
  });

  it('every valid chain verifies, and deleting, swapping or duplicating an entry is detected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(entryInput, { minLength: 2, maxLength: 6 }),
        fc.nat(),
        async (inputs, pick) => {
          const entries = await build(inputs);
          expect(await verifyLedgerChain(entries)).toEqual({
            ok: true,
            entries: entries.length,
            head_hash: entries.at(-1)?.hash,
          });
          const i = pick % (entries.length - 1);
          // Positions before i are untouched; the first position holding the wrong seq is the first bad one.
          const deleted = entries.filter((_, j) => j !== i);
          const swapped = entries.map((e, j) => (j === i ? entries[i + 1] : j === i + 1 ? entries[i] : e));
          const duplicated = [...entries.slice(0, i + 1), entries[i], ...entries.slice(i + 1)];
          const cases: [unknown[], number][] = [
            [deleted, i + 1],
            [swapped, i + 1],
            [duplicated, i + 2],
          ];
          for (const [bad, firstBad] of cases) {
            expect(await verifyLedgerChain(bad)).toEqual({
              ok: false,
              entries: bad.length,
              first_bad_seq: firstBad,
            });
          }
        },
      ),
      { seed: 3006, numRuns: 150 },
    );
  });
});
