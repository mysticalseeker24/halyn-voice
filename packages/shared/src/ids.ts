import { z } from 'zod';
import type { Clock, Rng } from './clock';
import { HalynError } from './errors';

/** ULID: 26 Crockford base32 characters; the first is 0–7 so the 48-bit timestamp cannot overflow. */
export const UlidSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, 'expected a ULID');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_ULID_TIME = 2 ** 48 - 1;

/** A ULID from the injected clock (48-bit ms time) and rng (80 random bits). Pure: no system clock or randomness. */
export function newUlid(clock: Clock, rng: Rng): string {
  const ms = clock.nowMs();
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_ULID_TIME)
    throw new HalynError('E_FAIL_CLOSED', `newUlid: clock outside the 48-bit range (${String(ms)})`);
  const random = rng.bytes(10);
  if (random.length !== 10) throw new HalynError('E_FAIL_CLOSED', 'newUlid: rng returned the wrong length');
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let bits = random.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  let tail = '';
  for (let i = 0; i < 16; i++, bits >>= 5n) tail = CROCKFORD[Number(bits & 31n)] + tail;
  return time + tail;
}

/** `<prefix>_<ULID>`, e.g. `pass_01JB…` (ADR-009). */
export function newId(prefix: string, clock: Clock, rng: Rng): string {
  if (!/^[a-z][a-z0-9]*$/.test(prefix))
    throw new HalynError('E_FAIL_CLOSED', `invalid id prefix "${prefix}"`);
  return `${prefix}_${newUlid(clock, rng)}`;
}

/**
 * Halyn entity id: `<prefix>_<body>`. Generated ids use a ULID body (`req_01J…`); seed ids are readable
 * (`ten_aero`, `cus_saksham`, `pass_demo`).
 */
export const IdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*_[A-Za-z0-9_]+$/, 'expected <prefix>_<id>');

/** An id schema pinned to one prefix, e.g. `prefixedId('cus')` accepts `cus_saksham`. */
export function prefixedId(prefix: string) {
  if (!/^[a-z][a-z0-9]*$/.test(prefix))
    throw new HalynError('E_FAIL_CLOSED', `invalid id prefix "${prefix}"`);
  return z
    .string()
    .max(64)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`), `expected ${prefix}_<id>`);
}

export const TenantIdSchema = prefixedId('ten');
export const CustomerIdSchema = prefixedId('cus');
export const PassIdSchema = prefixedId('pass');
export const RequestIdSchema = prefixedId('req');

/** Phone numbers are E.164 everywhere; logs mask them to the last 4 digits. */
export const E164Schema = z.string().regex(/^\+[1-9]\d{6,14}$/, 'expected an E.164 number');

/** Bolna's execution id for a call (opaque). */
export const RunIdSchema = z.string().min(1).max(128);

export const UnixSecondsSchema = z.int().nonnegative();
export const IsoDateTimeSchema = z.iso.datetime();

/** Lower-case SHA-256 hex (params hashes, ledger hashes, policy-pack source hashes). */
export const Hex64Schema = z.string().regex(/^[0-9a-f]{64}$/, 'expected lower-case SHA-256 hex');

export const Last4Schema = z.string().regex(/^\d{4}$/, 'expected the last 4 digits');
export const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, 'expected base64url without padding');

/** Scenario ids from docs/SCENARIOS.md: 1–12, plus 3b. */
export const ScenarioIdSchema = z
  .string()
  .regex(/^(?:[1-9]|1[0-2]|3b)$/, 'expected a scenario id (1–12, 3b)');
