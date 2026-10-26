import {
  Base64UrlSchema,
  CustomerIdSchema,
  E164Schema,
  Hex64Schema,
  IsoDateTimeSchema,
  PassIdSchema,
  PassScopesSchema,
  PassStatusSchema,
  prefixedId,
  TenantIdSchema,
} from '@halyn/shared';
import { z } from 'zod';

// Rows of `passes` and `pass_codes` (docs/DATA_MODEL.md). The Pass module only computes; the caller loads and stores.

export const PassRowSchema = z.strictObject({
  id: PassIdSchema,
  tenant_id: TenantIdSchema,
  customer_id: CustomerIdSchema,
  assistant_name: z.string().min(1).max(80),
  assistant_numbers: z.array(E164Schema).min(1).max(5),
  scopes: PassScopesSchema,
  issued_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
  status: PassStatusSchema,
  customer_sig: Base64UrlSchema,
  issuer_sig: Base64UrlSchema,
  failures: z.int().nonnegative(),
  revoked_at: IsoDateTimeSchema.nullable(),
});
export type PassRow = z.infer<typeof PassRowSchema>;

export const PassCodeIdSchema = prefixedId('pcode');

export const PassCodeRowSchema = z.strictObject({
  id: PassCodeIdSchema,
  pass_id: PassIdSchema,
  /** SHA-256(pepper ‖ code): the code itself is never stored. */
  code_hash: Hex64Schema,
  bound_number: E164Schema,
  expires_at: IsoDateTimeSchema,
  used_at: IsoDateTimeSchema.nullable(),
});
export type PassCodeRow = z.infer<typeof PassCodeRowSchema>;

/** Why a code did not verify. Internal only: the verify_pass tool answers `{ valid: false }` and nothing more. */
export type PassCodeFailure =
  'replayed' | 'expired' | 'wrong_number' | 'locked' | 'revoked' | 'pass_expired' | 'no_match';

/** Row changes the caller persists after a verify attempt. */
export interface PassUpdates {
  codes: { id: string; used_at: string }[];
  passes: { id: string; failures: number; status: PassRow['status'] }[];
}
