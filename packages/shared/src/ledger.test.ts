import { describe, expect, it } from 'vitest';
import { LedgerVerifyResponseSchema } from './api';
import { canonicalJson } from './canonical-json';
import { sha256Hex } from './crypto';
import {
  GENESIS_HASH,
  LEDGER_ENTRY_TYPES,
  type LedgerEntry,
  LedgerEntrySchema,
  ledgerHash,
  verifyLedgerChain,
} from './ledger';

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);

/** A valid chain of n entries for tenant ten_aero. */
async function chain(n: number, tenant = 'ten_aero'): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const body = {
      seq: i,
      tenant_id: tenant,
      type: LEDGER_ENTRY_TYPES[i % LEDGER_ENTRY_TYPES.length] ?? 'proposed',
      ref_id: `req_${i}`,
      payload: { i, note: `entry ${i}` },
      created_at: new Date(T0 + i * 1000).toISOString(),
    };
    const hash = await ledgerHash(prev, body);
    out.push({ ...body, prev_hash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('ledger hashing (invariant 6)', () => {
  it('hash = SHA-256(prev_hash ‖ canonical JSON of the body)', async () => {
    const [first] = await chain(1);
    const { prev_hash, hash, ...body } = first!;
    expect(prev_hash).toBe(GENESIS_HASH);
    expect(hash).toBe(await sha256Hex(prev_hash + canonicalJson(body)));
    expect(GENESIS_HASH).toBe('0'.repeat(64));
  });

  it('the entry schema matches docs/DATA_MODEL.md', async () => {
    const [first] = await chain(1);
    expect(LedgerEntrySchema.parse(first)).toEqual(first);
    expect(LedgerEntrySchema.safeParse({ ...first, extra: 1 }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...first, seq: 0 }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...first, type: 'deleted' }).success).toBe(false);
  });
});

describe('verifyLedgerChain', () => {
  it('accepts an empty chain and a valid chain, reporting the head', async () => {
    expect(await verifyLedgerChain([])).toEqual({ ok: true, entries: 0, head_hash: null });
    const entries = await chain(5);
    const result = await verifyLedgerChain(entries);
    expect(result).toEqual({ ok: true, entries: 5, head_hash: entries[4]?.hash });
    expect(LedgerVerifyResponseSchema.parse(result)).toEqual(result);
  });

  it.each<[string, (e: LedgerEntry[]) => unknown[], number]>([
    ['an edited payload', (e) => e.map((x, i) => (i === 2 ? { ...x, payload: { i: 99 } } : x)), 3],
    ['an edited hash', (e) => e.map((x, i) => (i === 1 ? { ...x, hash: 'f'.repeat(64) } : x)), 2],
    ['a broken link', (e) => e.map((x, i) => (i === 3 ? { ...x, prev_hash: GENESIS_HASH } : x)), 4],
    ['a deleted entry', (e) => [...e.slice(0, 2), ...e.slice(3)], 3],
    ['swapped entries', (e) => [e[0], e[2], e[1], e[3], e[4]], 2],
    ['a chain not starting at 1', (e) => e.slice(1), 1],
    ['a row that is not an entry', (e) => [e[0], { nope: true }, ...e.slice(2)], 2],
    ['an upper-case hash', (e) => e.map((x, i) => (i === 0 ? { ...x, hash: x.hash.toUpperCase() } : x)), 1],
  ])('detects %s at the first bad seq', async (_, mutate, firstBad) => {
    const tampered = mutate(await chain(5));
    const result = await verifyLedgerChain(tampered);
    expect(result).toEqual({ ok: false, entries: tampered.length, first_bad_seq: firstBad });
    expect(LedgerVerifyResponseSchema.safeParse(result).success).toBe(true);
  });

  it('detects an entry from another tenant even with a valid hash', async () => {
    const entries = await chain(2);
    const second = entries[1]!;
    const { prev_hash, hash: _hash, ...body } = second;
    const foreign = { ...body, tenant_id: 'ten_other' };
    const forged = { ...foreign, prev_hash, hash: await ledgerHash(prev_hash, foreign) };
    expect(await verifyLedgerChain([entries[0], forged])).toEqual({
      ok: false,
      entries: 2,
      first_bad_seq: 2,
    });
  });

  it('detects an appended forgery whose hash was recomputed but whose link is wrong', async () => {
    const entries = await chain(3);
    const body = {
      seq: 4,
      tenant_id: 'ten_aero',
      type: 'executed' as const,
      ref_id: 'req_x',
      payload: {},
      created_at: entries[2]!.created_at,
    };
    const forged = { ...body, prev_hash: entries[1]!.hash, hash: await ledgerHash(entries[1]!.hash, body) };
    expect(await verifyLedgerChain([...entries, forged])).toEqual({
      ok: false,
      entries: 4,
      first_bad_seq: 4,
    });
  });

  it('rejects a non-array input as bad from seq 1', async () => {
    expect(await verifyLedgerChain('nope' as never)).toEqual({ ok: false, entries: 0, first_bad_seq: 1 });
  });
});
