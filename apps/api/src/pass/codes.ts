import {
  type Clock,
  HalynError,
  newId,
  PASS_CODE,
  PassCodeInputSchema,
  type PassScope,
  type Rng,
  sha256Hex,
  TenantIdSchema,
  timingSafeEqual,
} from '@halyn/shared';
import type { z } from 'zod';
import {
  type PassCodeFailure,
  type PassCodeRow,
  PassCodeRowSchema,
  type PassRow,
  PassRowSchema,
  type PassUpdates,
} from './types';

// docs/PASS.md "Codes": 6 random digits, stored only as SHA-256(pepper ‖ code), single use, 5 minutes, bound to the
// assistant's calling number; five failures lock the Pass. Pure state transitions: the caller loads rows and persists
// the returned updates. Randomness comes from the injected rng (WebCrypto at the edge).

const MIN_PEPPER_LENGTH = 16;
/** Largest multiple of 10^6 that fits in 32 bits: draws at or above it are redrawn, so every code is equally likely. */
const DRAW_LIMIT = 4_294_000_000;
const MAX_DRAWS = 16;

function checkPepper(pepper: string): void {
  if (typeof pepper !== 'string' || pepper.length < MIN_PEPPER_LENGTH)
    throw new HalynError(
      'E_FAIL_CLOSED',
      `Pass codes need a pepper of at least ${MIN_PEPPER_LENGTH} characters`,
    );
}

function parseRow<S extends z.ZodType>(schema: S, row: unknown): z.infer<S> {
  const parsed = schema.safeParse(row);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', 'malformed Pass row');
  return parsed.data;
}

/** The Pass's effective state at `nowMs`: an `active` row past its expiry is expired. */
export function passState(pass: PassRow, nowMs: number): PassRow['status'] {
  if (pass.status !== 'active') return pass.status;
  return nowMs >= Date.parse(pass.expires_at) ? 'expired' : 'active';
}

type StateFailure = 'revoked' | 'locked' | 'pass_expired';

function stateFailure(state: PassRow['status']): StateFailure | null {
  if (state === 'active') return null;
  return state === 'expired' ? 'pass_expired' : state;
}

/** Six uniformly random digits from the rng (rejection sampling, so no digit is favoured). */
export function drawPassCode(rng: Rng): string {
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    const bytes = rng.bytes(4);
    if (bytes.length !== 4) break;
    const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
    if (value < DRAW_LIMIT) return String(value % 10 ** PASS_CODE.digits).padStart(PASS_CODE.digits, '0');
  }
  throw new HalynError('E_FAIL_CLOSED', 'mintPassCode: the rng gave no usable value');
}

export type MintPassCodeResult =
  { ok: true; code: string; record: PassCodeRow } | { ok: false; reason: StateFailure | 'wrong_number' };

/** A fresh code for the assistant to say on the call. Only `record` is stored; `code` goes back to the assistant. */
export async function mintPassCode(
  input: { pass: PassRow; calling_number: string; pepper: string },
  clock: Clock,
  rng: Rng,
): Promise<MintPassCodeResult> {
  checkPepper(input.pepper);
  const pass = parseRow(PassRowSchema, input.pass);
  const now = clock.nowMs();
  const refused = stateFailure(passState(pass, now));
  if (refused) return { ok: false, reason: refused };
  if (!pass.assistant_numbers.includes(input.calling_number)) return { ok: false, reason: 'wrong_number' };
  const code = drawPassCode(rng);
  const record = PassCodeRowSchema.parse({
    id: newId('pcode', clock, rng),
    pass_id: pass.id,
    code_hash: await sha256Hex(input.pepper + code),
    bound_number: input.calling_number,
    expires_at: new Date(now + PASS_CODE.ttl_seconds * 1000).toISOString(),
    used_at: null,
  });
  return { ok: true, code, record };
}

export interface PassCandidate {
  pass: PassRow;
  /** That Pass's code records (the caller may limit these to unexpired ones). */
  codes: readonly PassCodeRow[];
}

export type VerifyPassCodeResult =
  | { valid: true; pass_id: string; scopes: PassScope[]; updates: PassUpdates }
  | { valid: false; reason: PassCodeFailure; updates: PassUpdates };

/** One more failure on each pass; the 5th locks an active Pass. */
function failures(passes: readonly PassRow[]): PassUpdates['passes'] {
  return passes.map((p) => {
    const count = p.failures + 1;
    const status = p.status === 'active' && count >= PASS_CODE.max_failures ? 'locked' : p.status;
    return { id: p.id, failures: count, status };
  });
}

/**
 * Check a spoken code from `from_number` against the tenant's Passes that list that number. Every record is compared
 * (in constant time per comparison) before deciding, and every failed attempt counts towards the lock. A code is bound
 * to (Pass, tenant, number): a candidate from another tenant means the caller read across tenants, so it fails closed.
 */
export async function verifyPassCode(
  input: {
    tenant_id: string;
    code: string;
    from_number: string;
    candidates: readonly PassCandidate[];
    pepper: string;
  },
  clock: Clock,
): Promise<VerifyPassCodeResult> {
  checkPepper(input.pepper);
  if (!TenantIdSchema.safeParse(input.tenant_id).success)
    throw new HalynError('E_FAIL_CLOSED', 'verifyPassCode: invalid tenant');
  const candidates = input.candidates.map((c) => ({
    pass: parseRow(PassRowSchema, c.pass),
    codes: c.codes.map((r) => parseRow(PassCodeRowSchema, r)),
  }));
  if (candidates.some((c) => c.pass.tenant_id !== input.tenant_id))
    throw new HalynError('E_FAIL_CLOSED', 'verifyPassCode: a candidate Pass belongs to another tenant');
  const now = clock.nowMs();
  const normalised = PassCodeInputSchema.safeParse(input.code);
  const hash = normalised.success ? await sha256Hex(input.pepper + normalised.data) : '';

  let match: { pass: PassRow; record: PassCodeRow } | null = null;
  for (const { pass, codes } of candidates)
    for (const record of codes)
      if (timingSafeEqual(record.code_hash, hash) && !match) match = { pass, record };

  const fail = (reason: PassCodeFailure, passes: readonly PassRow[]): VerifyPassCodeResult => ({
    valid: false,
    reason,
    updates: { codes: [], passes: failures(passes) },
  });
  if (!match)
    return fail(
      'no_match',
      candidates.map((c) => c.pass),
    );

  const { pass, record } = match;
  const refused = stateFailure(passState(pass, now));
  if (refused) return fail(refused, [pass]);
  if (record.used_at !== null) return fail('replayed', [pass]);
  if (now >= Date.parse(record.expires_at)) return fail('expired', [pass]);
  if (record.bound_number !== input.from_number || !pass.assistant_numbers.includes(input.from_number))
    return fail('wrong_number', [pass]);
  return {
    valid: true,
    pass_id: pass.id,
    scopes: pass.scopes,
    updates: { codes: [{ id: record.id, used_at: new Date(now).toISOString() }], passes: [] },
  };
}
