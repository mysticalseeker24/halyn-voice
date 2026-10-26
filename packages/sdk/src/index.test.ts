import { GENESIS_HASH, ledgerHash } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import * as sdk from './index';

describe('@halyn/sdk public surface', () => {
  it.each(['verifyGrant', 'verifyLedger', 'proposeAction'])('exports %s', (name) => {
    expect(sdk).toHaveProperty(name);
  });

  it('verifyLedger reports the head of a valid chain and the first bad seq of an edited one', async () => {
    const body = {
      seq: 1,
      tenant_id: 'ten_aero',
      type: 'executed' as const,
      ref_id: 'req_1',
      payload: { reference: 'AERO-1' },
      created_at: '2026-10-26T10:00:00.000Z',
    };
    const entry = { ...body, prev_hash: GENESIS_HASH, hash: await ledgerHash(GENESIS_HASH, body) };
    expect(await sdk.verifyLedger([entry])).toEqual({ ok: true, entries: 1, head_hash: entry.hash });
    expect(await sdk.verifyLedger([{ ...entry, payload: { reference: 'AERO-2' } }])).toEqual({
      ok: false,
      entries: 1,
      first_bad_seq: 1,
    });
  });
});
