import {
  type Clock,
  GENESIS_HASH,
  HalynError,
  Hex64Schema,
  type JsonValue,
  type LedgerEntry,
  LedgerEntrySchema,
  type LedgerEntryType,
  ledgerHash,
  maskDeep,
} from '@halyn/shared';

// Invariant 6: the next link of a tenant's chain. The Hub (Step 5) calls this one entry at a time, in order, and is
// the only writer of ledger_entries. Pure apart from the injected clock; anything malformed throws E_FAIL_CLOSED.

export interface LedgerHead {
  seq: number;
  hash: string;
}

export interface LedgerAppend {
  tenant_id: string;
  type: LedgerEntryType;
  ref_id: string;
  payload: Record<string, JsonValue>;
}

export async function nextLedgerEntry(
  head: LedgerHead | null,
  input: LedgerAppend,
  clock: Clock,
): Promise<LedgerEntry> {
  if (head && (!Number.isSafeInteger(head.seq) || head.seq < 1 || !Hex64Schema.safeParse(head.hash).success))
    throw new HalynError('E_FAIL_CLOSED', 'nextLedgerEntry: invalid chain head');
  const prev_hash = head?.hash ?? GENESIS_HASH;
  const body = {
    seq: (head?.seq ?? 0) + 1,
    tenant_id: input.tenant_id,
    type: input.type,
    ref_id: input.ref_id,
    payload: maskDeep(input.payload) as Record<string, JsonValue>,
    created_at: new Date(clock.nowMs()).toISOString(),
  };
  const entry = LedgerEntrySchema.safeParse({ ...body, prev_hash, hash: await ledgerHash(prev_hash, body) });
  if (!entry.success) throw new HalynError('E_FAIL_CLOSED', 'nextLedgerEntry: invalid entry');
  return entry.data;
}
