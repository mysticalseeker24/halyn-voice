import { GENESIS_HASH, HalynError } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { tidbLedgerSink } from './ledger-sink';

const entry = {
  seq: 1,
  tenant_id: 'ten_aero',
  type: 'proposed' as const,
  ref_id: 'req_1',
  payload: {},
  prev_hash: GENESIS_HASH,
  hash: 'a'.repeat(64),
  created_at: '2026-10-26T00:00:00.000Z',
};

describe('tidbLedgerSink', () => {
  it('fails closed without a valid TIDB_DATABASE_URL, so the outbox keeps the rows', async () => {
    for (const env of [{}, { TIDB_DATABASE_URL: 'https://nope' }])
      await expect(tidbLedgerSink(env).persist('ten_aero', [entry])).rejects.toBeInstanceOf(HalynError);
  });
});
