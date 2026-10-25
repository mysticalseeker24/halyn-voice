import { z } from 'zod';
import { ActionIdSchema } from './actions';
import {
  CustomerIdSchema,
  Hex64Schema,
  RequestIdSchema,
  TenantIdSchema,
  UlidSchema,
  UnixSecondsSchema,
} from './ids';
import { jwsHeaderSchema } from './jws';

// Invariant 1: Aero Core accepts a write only with a Halyn-signed grant bound to the exact params,
// living at most 120 s, whose jti was never used before.

export const GRANT_VERSION = 'halyn-grant/0.1';
export const GRANT_MAX_TTL_SECONDS = 120;

export const GrantClaimsSchema = z
  .strictObject({
    v: z.literal(GRANT_VERSION),
    jti: UlidSchema,
    iss: z.literal('halyn'),
    aud: z.literal('aero-core'),
    tenant: TenantIdSchema,
    sub: CustomerIdSchema,
    action: ActionIdSchema,
    /** SHA-256 hex of canonicalJson(params). */
    params_hash: Hex64Schema,
    request_id: RequestIdSchema,
    iat: UnixSecondsSchema,
    exp: UnixSecondsSchema,
  })
  .refine((g) => g.exp > g.iat && g.exp - g.iat <= GRANT_MAX_TTL_SECONDS, {
    path: ['exp'],
    error: `a grant lives more than 0 and at most ${GRANT_MAX_TTL_SECONDS} s`,
  });
export type GrantClaims = z.infer<typeof GrantClaimsSchema>;

export const GrantHeaderSchema = jwsHeaderSchema('halyn-grant+jwt');
