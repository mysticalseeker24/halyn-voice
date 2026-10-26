import {
  base64urlDecode,
  base64urlEncode,
  canonicalJson,
  CustomerIdSchema,
  HalynError,
  TenantIdSchema,
  utf8,
} from '@halyn/shared';
import { z } from 'zod';

// Web session tokens for the four apps: a compact JWS, HMAC-SHA256 with SESSION_SECRET (WebCrypto). Deliberately a
// different key and algorithm from the Ed25519 grant/Pass key, so a session can never pass as a grant or a Pass.
// Verification order: shape, strict header, signature, then claims — nothing is trusted before the signature checks.

export const SESSION_TYP = 'halyn-session+jwt';
export const SESSION_VERSION = 'halyn-session/0.1';
export const SESSION_MAX_TTL_SECONDS = 12 * 60 * 60;
const IAT_SKEW_SECONDS = 5;
const MAX_TOKEN_LENGTH = 2048;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export const SessionKindSchema = z.enum(['customer', 'console']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

const HeaderSchema = z.strictObject({ alg: z.literal('HS256'), typ: z.literal(SESSION_TYP) });

export const SessionClaimsSchema = z
  .strictObject({
    v: z.literal(SESSION_VERSION),
    tenant: TenantIdSchema,
    kind: SessionKindSchema,
    /** The customer, or the literal "console" for a bank team member. */
    sub: z.union([CustomerIdSchema, z.literal('console')]),
    iat: z.int().nonnegative(),
    exp: z.int().nonnegative(),
  })
  .refine((c) => c.exp > c.iat && c.exp - c.iat <= SESSION_MAX_TTL_SECONDS, { path: ['exp'] })
  .refine((c) => (c.kind === 'console') === (c.sub === 'console'), { path: ['sub'] });
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

/** What a verified token gives a route: the tenant always comes from here, never from the request. */
export interface Session {
  tenant_id: string;
  kind: SessionKind;
  customer_id: string | null;
  expires_at: string;
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keys.set(secret, key);
  }
  return key;
}

function toSession(claims: SessionClaims): Session {
  return {
    tenant_id: claims.tenant,
    kind: claims.kind,
    customer_id: claims.kind === 'customer' ? claims.sub : null,
    expires_at: new Date(claims.exp * 1000).toISOString(),
  };
}

export interface SessionInput {
  tenant_id: string;
  kind: SessionKind;
  customer_id: string | null;
}

export async function signSession(
  input: SessionInput,
  secret: string,
  nowMs: number,
  ttlSeconds = SESSION_MAX_TTL_SECONDS,
): Promise<{ token: string; session: Session }> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > SESSION_MAX_TTL_SECONDS)
    throw new HalynError('E_FAIL_CLOSED', 'signSession: ttl must be 1–43200 s');
  const iat = Math.floor(nowMs / 1000);
  const claims = SessionClaimsSchema.safeParse({
    v: SESSION_VERSION,
    tenant: input.tenant_id,
    kind: input.kind,
    sub: input.kind === 'console' ? 'console' : input.customer_id,
    iat,
    exp: iat + ttlSeconds,
  });
  if (!claims.success) throw new HalynError('E_FAIL_CLOSED', 'signSession: invalid session claims');
  const signingInput = `${base64urlEncode(utf8(canonicalJson({ alg: 'HS256', typ: SESSION_TYP })))}.${base64urlEncode(utf8(canonicalJson(claims.data)))}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(signingInput));
  return {
    token: `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`,
    session: toSession(claims.data),
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return undefined;
  }
}

/** The session a token proves, or null for anything malformed, forged, expired or issued in the future. */
export async function verifySession(token: unknown, secret: string, nowMs: number): Promise<Session | null> {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return null;
  const [h = '', p = '', s = ''] = parts;
  const headerBytes = base64urlDecode(h);
  const payloadBytes = base64urlDecode(p);
  const signature = base64urlDecode(s);
  if (!headerBytes || !payloadBytes || !signature || signature.length !== 32) return null;
  if (!HeaderSchema.safeParse(parseJson(headerBytes)).success) return null;
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, utf8(`${h}.${p}`));
  if (!valid) return null;
  const claims = SessionClaimsSchema.safeParse(parseJson(payloadBytes));
  if (!claims.success) return null;
  const nowSeconds = nowMs / 1000;
  if (claims.data.exp <= nowSeconds || claims.data.iat > nowSeconds + IAT_SKEW_SECONDS) return null;
  return toSession(claims.data);
}
