import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, type LedgerEntry, ledgerHash, verifyLedgerChain } from './ledger';

// Test-engineer pass (Step 3): invariant 6 beyond single-row edits — every field, a full re-chain, truncation,
// mixed tenants, and the cost of verifying a long chain.

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);

async function chain(
  n: number,
  tenant = 'ten_aero',
  payload: (i: number) => LedgerEntry['payload'] = (i) => ({ i, nested: { list: [i, `x${i}`] } }),
): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const body = {
      seq: i + 1,
      tenant_id: tenant,
      type: 'decided' as const,
      ref_id: `req_${i}`,
      payload: payload(i),
      created_at: new Date(T0 + i * 1000).toISOString(),
    };
    const hash = await ledgerHash(prev, body);
    out.push({ ...body, prev_hash: prev, hash });
    prev = hash;
  }
  return out;
}

/** Recompute every hash from `from` onward, as an insider with database access would after editing a row. */
async function rechain(entries: LedgerEntry[], from: number): Promise<LedgerEntry[]> {
  const out = entries.slice(0, from);
  let prev = from === 0 ? GENESIS_HASH : (out[from - 1]?.hash ?? GENESIS_HASH);
  for (const e of entries.slice(from)) {
    const hash = await ledgerHash(prev, e);
    out.push({ ...e, prev_hash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('every field of an entry is covered', () => {
  const edits: [string, (e: LedgerEntry) => LedgerEntry][] = [
    ['seq', (e) => ({ ...e, seq: e.seq + 10 })],
    ['tenant_id', (e) => ({ ...e, tenant_id: 'ten_other' })],
    ['type', (e) => ({ ...e, type: 'executed' })],
    ['ref_id', (e) => ({ ...e, ref_id: `${e.ref_id}x` })],
    ['a top-level payload value', (e) => ({ ...e, payload: { ...e.payload, i: 999 } })],
    ['a deep payload value', (e) => ({ ...e, payload: { ...e.payload, nested: { list: [2, 'x9'] } } })],
    ['an added payload key', (e) => ({ ...e, payload: { ...e.payload, extra: true } })],
    ['created_at by one millisecond', (e) => ({ ...e, created_at: '2026-10-26T10:00:02.001Z' })],
    ['prev_hash', (e) => ({ ...e, prev_hash: 'a'.repeat(64) })],
    ['hash', (e) => ({ ...e, hash: `${e.hash.slice(0, -1)}${e.hash.endsWith('0') ? '1' : '0'}` })],
  ];
  it.each(edits)('an edited %s is detected at that entry', async (_, edit) => {
    const entries = await chain(5);
    const tampered = entries.map((e, i) => (i === 2 ? edit(e) : e));
    expect(await verifyLedgerChain(tampered)).toEqual({ ok: false, entries: 5, first_bad_seq: 3 });
  });
});

describe('a rewritten history (design gap closed by an anchor)', () => {
  it('without an anchor, an insider who edits a row and re-chains everything after it is NOT detected', async () => {
    // This is the limit of a hash chain on its own; the test documents it so nobody relies on more.
    const entries = await chain(6);
    const edited = entries.map((e, i) => (i === 2 ? { ...e, payload: { i: 999 } } : e));
    expect((await verifyLedgerChain(await rechain(edited, 2))).ok).toBe(true);
  });

  it('with the published head as an anchor, the same rewrite is detected', async () => {
    const entries = await chain(6);
    const anchor = { seq: 6, hash: entries[5]?.hash ?? '' };
    const edited = entries.map((e, i) => (i === 2 ? { ...e, payload: { i: 999 } } : e));
    const rewritten = await rechain(edited, 2);
    expect(await verifyLedgerChain(entries, { anchor })).toEqual({
      ok: true,
      entries: 6,
      head_hash: anchor.hash,
    });
    expect(await verifyLedgerChain(rewritten, { anchor })).toEqual({
      ok: false,
      entries: 6,
      first_bad_seq: 6,
    });
  });

  it('an anchor in the middle of a longer chain is checked at its seq', async () => {
    const entries = await chain(8);
    const anchor = { seq: 4, hash: entries[3]?.hash ?? '' };
    expect((await verifyLedgerChain(entries, { anchor })).ok).toBe(true);
    const rewritten = await rechain(
      entries.map((e, i) => (i === 1 ? { ...e, ref_id: 'req_forged' } : e)),
      1,
    );
    expect(await verifyLedgerChain(rewritten, { anchor })).toEqual({
      ok: false,
      entries: 8,
      first_bad_seq: 4,
    });
  });

  it('truncating the tail is invisible without an anchor and detected with one', async () => {
    const entries = await chain(6);
    const anchor = { seq: 6, hash: entries[5]?.hash ?? '' };
    const truncated = entries.slice(0, 4);
    expect((await verifyLedgerChain(truncated)).ok).toBe(true);
    expect(await verifyLedgerChain(truncated, { anchor })).toEqual({
      ok: false,
      entries: 4,
      first_bad_seq: 5,
    });
    expect(await verifyLedgerChain([], { anchor })).toEqual({ ok: false, entries: 0, first_bad_seq: 1 });
  });

  it.each([
    ['seq 0', { seq: 0, hash: 'a'.repeat(64) }],
    ['a fractional seq', { seq: 1.5, hash: 'a'.repeat(64) }],
    ['a hash that is not hex64', { seq: 1, hash: 'nope' }],
  ])('a malformed anchor (%s) fails closed', async (_, anchor) => {
    const entries = await chain(3);
    expect(await verifyLedgerChain(entries, { anchor })).toEqual({
      ok: false,
      entries: 3,
      first_bad_seq: 1,
    });
  });
});

describe('chain shape attacks', () => {
  it('two tenants interleaved: the first foreign row is the first bad one', async () => {
    const a = await chain(4, 'ten_aero');
    const b = await chain(4, 'ten_other');
    const mixed = [a[0], a[1], b[2], a[3]];
    expect(await verifyLedgerChain(mixed)).toEqual({ ok: false, entries: 4, first_bad_seq: 3 });
    // Each tenant's own chain is fine on its own.
    expect((await verifyLedgerChain(b)).ok).toBe(true);
  });

  it('a chain whose first row claims seq 0 is bad from 1', async () => {
    const entries = await chain(2);
    expect(await verifyLedgerChain([{ ...entries[0], seq: 0 }, entries[1]])).toEqual({
      ok: false,
      entries: 2,
      first_bad_seq: 1,
    });
  });

  it('an empty chain verifies with no head', async () => {
    expect(await verifyLedgerChain([])).toEqual({ ok: true, entries: 0, head_hash: null });
  });
});
// The 10 000-entry timing check lives in test/ledger-performance.test.ts: src/ is pure and may not read a clock.
