import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, type LedgerEntry, ledgerHash, verifyLedgerChain } from '../src/index';

// GET /web/ledger/verify and an auditor's export check walk the whole chain; it must stay fast as the ledger grows.
// (Test-only timing, kept out of src/, which the purity rule forbids from reading a clock.)
// Wall-clock time on a shared runner is noisy (Turbo runs other suites in parallel; CI hit 1,154 ms once), so this
// takes the best of three runs against a 2 s bound. Verification is ~200 ms per 10 000 entries in Node (ADR-012); the
// bound is there to catch a non-linear regression (a quadratic walk would take minutes), not to benchmark.

describe('ledger verification cost', () => {
  it('verifies 10 000 entries in linear time (best of 3 runs under 2 s)', { timeout: 30_000 }, async () => {
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
    const runs: number[] = [];
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const result = await verifyLedgerChain(entries);
      runs.push(performance.now() - started);
      expect(result).toEqual({ ok: true, entries: 10_000, head_hash: prev });
    }
    expect(Math.min(...runs)).toBeLessThan(2000);
  });
});
