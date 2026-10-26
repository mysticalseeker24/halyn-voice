import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, type LedgerEntry, ledgerHash, verifyLedgerChain } from '../src/index';

// GET /web/ledger/verify and an auditor's export check walk the whole chain; it must stay fast as the ledger grows.
// (Test-only timing, kept out of src/, which the purity rule forbids from reading a clock.)

describe('ledger verification cost', () => {
  it('verifies 10 000 entries in well under a second', async () => {
    const entries: LedgerEntry[] = [];
    let prev = GENESIS_HASH;
    for (let i = 0; i < 10_000; i++) {
      const body = {
        seq: i + 1,
        tenant_id: 'ten_aero',
        type: 'decided' as const,
        ref_id: `req_${i}`,
        payload: { i, outcome: 'allow', amount_minor: i * 100 },
        created_at: new Date(Date.UTC(2026, 9, 26) + i * 1000).toISOString(),
      };
      const hash = await ledgerHash(prev, body);
      entries.push({ ...body, prev_hash: prev, hash });
      prev = hash;
    }
    const started = performance.now();
    const result = await verifyLedgerChain(entries);
    const ms = performance.now() - started;
    expect(result).toEqual({ ok: true, entries: 10_000, head_hash: prev });
    expect(ms).toBeLessThan(1000);
  });
});
