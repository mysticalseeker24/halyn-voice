import { E164Schema, HalynError, sha256Hex } from '@halyn/shared';

// Registered numbers are stored as SHA-256(PHONE_HASH_PEPPER ‖ E.164) plus the last 4 digits; the full number lives
// only in the caller's env (CUSTOMER_PHONE) and in Bolna's call context. lookup_customer (Step 7) hashes the incoming
// caller number the same way.

export async function registeredNumberHash(pepper: string, e164: string): Promise<string> {
  if (pepper.length < 32) throw new HalynError('E_FAIL_CLOSED', 'numbers: pepper too short');
  if (!E164Schema.safeParse(e164).success)
    throw new HalynError('E_FAIL_CLOSED', 'numbers: not an E.164 number');
  return sha256Hex(pepper + e164);
}

export function last4(e164: string): string {
  if (!E164Schema.safeParse(e164).success)
    throw new HalynError('E_FAIL_CLOSED', 'numbers: not an E.164 number');
  return e164.slice(-4);
}
