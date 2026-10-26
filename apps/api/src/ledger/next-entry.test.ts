import { fixedClock, GENESIS_HASH, HalynError, type LedgerEntry, LedgerEntrySchema } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { nextLedgerEntry, verifyLedger } from './index';

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);

async function appendAll(n: number): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  for (let i = 0; i < n; i++) {
    const head = out.at(-1) ?? null;
    out.push(
      await nextLedgerEntry(
        head,
        { tenant_id: 'ten_aero', type: 'proposed', ref_id: `req_${i}`, payload: { i } },
        fixedClock(T0 + i * 1000),
      ),
    );
  }
  return out;
}

describe('nextLedgerEntry', () => {
  it('starts at seq 1 on the genesis hash and links each entry to the previous one', async () => {
    const entries = await appendAll(3);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0]?.prev_hash).toBe(GENESIS_HASH);
    expect(entries[1]?.prev_hash).toBe(entries[0]?.hash);
    expect(entries[2]?.created_at).toBe(new Date(T0 + 2000).toISOString());
    for (const e of entries) expect(LedgerEntrySchema.parse(e)).toEqual(e);
    expect(await verifyLedger(entries)).toEqual({ ok: true, entries: 3, head_hash: entries[2]?.hash });
  });

  it('masks phone and account numbers in the payload before hashing', async () => {
    const entry = await nextLedgerEntry(
      null,
      {
        tenant_id: 'ten_aero',
        type: 'proposed',
        ref_id: 'req_1',
        payload: {
          from: '+918065356344',
          params: { payee_account_last4: '4471' },
          note: 'acct 123456789012',
        },
      },
      fixedClock(T0),
    );
    expect(entry.payload).toEqual({
      from: '••••6344',
      params: { payee_account_last4: '4471' },
      note: 'acct ••••9012',
    });
    expect(JSON.stringify(entry)).not.toContain('8065356344');
    expect(await verifyLedger([entry])).toMatchObject({ ok: true });
  });

  it('is deterministic: the same head, input and clock give the same entry', async () => {
    const input = {
      tenant_id: 'ten_aero',
      type: 'decided',
      ref_id: 'req_1',
      payload: { outcome: 'allow' },
    } as const;
    expect(await nextLedgerEntry(null, input, fixedClock(T0))).toEqual(
      await nextLedgerEntry(null, input, fixedClock(T0)),
    );
  });

  it.each([
    ['a head with seq 0', { seq: 0, hash: GENESIS_HASH }],
    ['a head with a bad hash', { seq: 1, hash: 'nope' }],
  ])('fails closed on %s', async (_, head) => {
    await expect(
      nextLedgerEntry(
        head,
        { tenant_id: 'ten_aero', type: 'proposed', ref_id: 'req_1', payload: {} },
        fixedClock(T0),
      ),
    ).rejects.toThrow(HalynError);
  });

  it.each([
    ['an unknown entry type', { tenant_id: 'ten_aero', type: 'deleted', ref_id: 'req_1', payload: {} }],
    ['a bad tenant', { tenant_id: 'aero', type: 'proposed', ref_id: 'req_1', payload: {} }],
    [
      'a payload that is not JSON data',
      { tenant_id: 'ten_aero', type: 'proposed', ref_id: 'r', payload: { n: Number.NaN } },
    ],
  ])('fails closed on %s', async (_, input) => {
    await expect(nextLedgerEntry(null, input as never, fixedClock(T0))).rejects.toThrow(HalynError);
  });
});
