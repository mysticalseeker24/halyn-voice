import { z } from 'zod';
import { canonicalJson } from './canonical-json';
import { sha256Hex, timingSafeEqual } from './crypto';
import { Hex64Schema, IsoDateTimeSchema, TenantIdSchema } from './ids';

// Invariant 6: the ledger is append-only and hash-chained. hash = SHA-256(prev_hash ‖ canonical_json(body)), where the
// body is every field except prev_hash and hash. Appends go through the tenant's Hub (Step 5), so order is strict.

export const GENESIS_HASH = '0'.repeat(64);

export const LEDGER_ENTRY_TYPES = [
  'proposed',
  'decided',
  'confirm_requested',
  'confirmed',
  'executed',
  'handoff',
  'pass_issued',
  'pass_revoked',
  'pass_locked',
  'grant_issued',
  'core_rejected',
] as const;
export const LedgerEntryTypeSchema = z.enum(LEDGER_ENTRY_TYPES);
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;

export const LedgerPayloadSchema = z.record(z.string(), z.json());

export const LedgerEntrySchema = z.strictObject({
  seq: z.int().positive(),
  tenant_id: TenantIdSchema,
  type: LedgerEntryTypeSchema,
  ref_id: z.string().min(1).max(64),
  /** Masked before it is hashed (phone and account numbers → last 4). */
  payload: LedgerPayloadSchema,
  prev_hash: Hex64Schema,
  hash: Hex64Schema,
  created_at: IsoDateTimeSchema,
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type LedgerBody = Omit<LedgerEntry, 'prev_hash' | 'hash'>;

/** The chain hash of one entry. */
export function ledgerHash(prevHash: string, body: LedgerBody): Promise<string> {
  const { seq, tenant_id, type, ref_id, payload, created_at } = body;
  return sha256Hex(prevHash + canonicalJson({ seq, tenant_id, type, ref_id, payload, created_at }));
}

export type LedgerVerifyResult =
  | { ok: true; entries: number; head_hash: string | null }
  | { ok: false; entries: number; first_bad_seq: number };

/**
 * A `(seq, hash)` pair recorded outside the rows (the Hub's `ledger_head`, an export receipt, a published head). A
 * chain alone cannot show that someone with database access rewrote a row and re-hashed everything after it, or cut
 * off the tail; checking against an anchor can.
 */
export const LedgerAnchorSchema = z.strictObject({ seq: z.int().positive(), hash: Hex64Schema });
export type LedgerAnchor = z.infer<typeof LedgerAnchorSchema>;

export interface VerifyLedgerOptions {
  anchor?: LedgerAnchor;
}

/**
 * Verify a tenant's whole chain from seq 1. The first position whose row is malformed, out of sequence, from another
 * tenant, not linked to the previous hash, or whose hash does not recompute is reported as `first_bad_seq`. With an
 * anchor: a chain shorter than the anchor is bad from the first missing seq, and a chain whose entry at the anchor's
 * seq has another hash is bad at that seq (some entry at or before it was rewritten). A malformed anchor fails closed.
 */
export async function verifyLedgerChain(
  entries: readonly unknown[],
  options: VerifyLedgerOptions = {},
): Promise<LedgerVerifyResult> {
  if (!Array.isArray(entries)) return { ok: false, entries: 0, first_bad_seq: 1 };
  const badAt = (seq: number): LedgerVerifyResult => ({
    ok: false,
    entries: entries.length,
    first_bad_seq: seq,
  });
  const anchor = options.anchor === undefined ? null : LedgerAnchorSchema.safeParse(options.anchor);
  if (anchor && !anchor.success) return badAt(1);

  // Pass 1, synchronous: shape, sequence, tenant and links, up to the first row that breaks one of them.
  const rows: LedgerEntry[] = [];
  let structuralBad: number | null = null;
  let prev = GENESIS_HASH;
  let tenant: string | null = null;
  for (const [i, row] of entries.entries()) {
    const parsed = LedgerEntrySchema.safeParse(row);
    const entry = parsed.success ? parsed.data : null;
    tenant ??= entry?.tenant_id ?? null;
    if (
      !entry ||
      entry.seq !== i + 1 ||
      entry.tenant_id !== tenant ||
      !timingSafeEqual(entry.prev_hash, prev)
    ) {
      structuralBad = i + 1;
      break;
    }
    rows.push(entry);
    prev = entry.hash;
  }

  // Pass 2: recompute every hash. Each row carries its own prev_hash (just checked against the row before), so the
  // digests are independent and run concurrently, in bounded batches. Any mismatch here precedes structuralBad.
  for (let start = 0; start < rows.length; start += HASH_BATCH) {
    const checked = await Promise.all(
      rows
        .slice(start, start + HASH_BATCH)
        .map(async (entry) => ({ entry, hash: await ledgerHash(entry.prev_hash, entry) })),
    );
    for (const { entry, hash } of checked) {
      if (!timingSafeEqual(hash, entry.hash)) return badAt(entry.seq);
      if (anchor?.data.seq === entry.seq && !timingSafeEqual(entry.hash, anchor.data.hash))
        return badAt(entry.seq);
    }
  }
  if (structuralBad !== null) return badAt(structuralBad);
  if (anchor && entries.length < anchor.data.seq) return badAt(entries.length + 1);
  return { ok: true, entries: entries.length, head_hash: entries.length === 0 ? null : prev };
}

/** How many entry hashes are computed concurrently while verifying. */
const HASH_BATCH = 512;
