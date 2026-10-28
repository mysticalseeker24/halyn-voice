import { z } from 'zod';
import { Base64UrlSchema } from './ids';

// WebAuthn's JSON forms (the shapes of PublicKeyCredential.toJSON() and the *OptionsJSON dictionaries, Level 3), as
// the Aero app and the API exchange them for passkey registration and the Confirm passkey leg (docs/API.md "Web").
// Binary fields are base64url without padding. Sizes are capped: the API parses these before any signature check.

const B64 = (max: number) => Base64UrlSchema.max(max);

/** COSE algorithms the API accepts: EdDSA (Ed25519), ES256 (P-256), RS256. */
export const WEBAUTHN_ALGORITHMS = [-8, -7, -257] as const;
export const WebAuthnAlgorithmSchema = z.union([z.literal(-8), z.literal(-7), z.literal(-257)]);

export const CredentialDescriptorSchema = z.strictObject({
  type: z.literal('public-key'),
  id: B64(1366),
  transports: z.array(z.string().max(32)).max(8).optional(),
});

export const CreationOptionsJsonSchema = z.strictObject({
  rp: z.strictObject({ id: z.string().min(1).max(253), name: z.string().min(1).max(64) }),
  user: z.strictObject({
    id: B64(86),
    name: z.string().min(1).max(64),
    displayName: z.string().min(1).max(64),
  }),
  challenge: B64(128),
  pubKeyCredParams: z
    .array(z.strictObject({ type: z.literal('public-key'), alg: WebAuthnAlgorithmSchema }))
    .min(1),
  timeout: z.int().positive(),
  attestation: z.literal('none'),
  authenticatorSelection: z.strictObject({
    residentKey: z.enum(['discouraged', 'preferred', 'required']),
    userVerification: z.literal('required'),
  }),
  excludeCredentials: z.array(CredentialDescriptorSchema).max(16),
});
export type CreationOptionsJson = z.infer<typeof CreationOptionsJsonSchema>;

export const RequestOptionsJsonSchema = z.strictObject({
  challenge: B64(128),
  rpId: z.string().min(1).max(253),
  timeout: z.int().positive(),
  userVerification: z.literal('required'),
  allowCredentials: z.array(CredentialDescriptorSchema).max(16),
});
export type RequestOptionsJson = z.infer<typeof RequestOptionsJsonSchema>;

/** `navigator.credentials.create()` → `.toJSON()`. Unknown keys (extension results, attachment) are stripped. */
export const RegistrationCredentialJsonSchema = z.object({
  id: B64(1366),
  rawId: B64(1366),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: B64(4096),
    attestationObject: B64(16384),
    transports: z.array(z.string().max(32)).max(8).optional(),
  }),
});
export type RegistrationCredentialJson = z.infer<typeof RegistrationCredentialJsonSchema>;

/** `navigator.credentials.get()` → `.toJSON()`. */
export const AuthenticationCredentialJsonSchema = z.object({
  id: B64(1366),
  rawId: B64(1366),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: B64(4096),
    authenticatorData: B64(2048),
    signature: B64(1024),
    userHandle: B64(128).nullish(),
  }),
});
export type AuthenticationCredentialJson = z.infer<typeof AuthenticationCredentialJsonSchema>;
