import { z } from 'zod';

/** Compact JWS (`header.payload.signature`, base64url). Passes and grants are EdDSA-signed by Halyn. */
export const CompactJwsSchema = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'expected a compact JWS');

/** Protected header for a Halyn token: Ed25519 only, a key id, and the token's media type. */
export function jwsHeaderSchema<T extends string>(typ: T) {
  return z.strictObject({
    alg: z.literal('EdDSA'),
    kid: z.string().min(1).max(64),
    typ: z.literal(typ),
  });
}
