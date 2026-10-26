import { z } from 'zod';
import { canonicalJson } from './canonical-json';
import { HalynError } from './errors';
import { jwsHeaderSchema } from './jws';

// The one implementation of every crypto rule Halyn relies on (grants, Passes, ledger, SDK). WebCrypto only, so it
// runs unchanged in Workers, Node and browsers. Deterministic: no randomness here (Ed25519 signing is deterministic).

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** RFC 4648 §5 base64url without padding. */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    let n = 0;
    for (let j = 0; j < 3; j++) n = (n << 8) | (bytes[i + j] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += B64[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/**
 * Strict base64url decode: only the url-safe alphabet, no padding, no impossible lengths, and unused trailing bits
 * must be zero, so every byte string has exactly one accepted encoding. Returns null on anything else.
 */
export function base64urlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let k = 0;
  for (const char of text) {
    const v = B64_INDEX.get(char);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[k++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return acc === 0 ? out : null;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lower-case hex SHA-256 of a string (as UTF-8) or bytes. */
export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? utf8(data) : data));
}

/** The grant's params binding (invariant 1): SHA-256 hex of the canonical JSON of the exact params. */
export function paramsHash(params: unknown): Promise<string> {
  return sha256Hex(canonicalJson(params));
}

/** Equal-length strings compared without an early exit (hashes, hex, codes). Length itself is not secret. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Ed25519 keys (JWK / JWKS) ──────────────────────────────────────────────────────────────────────

const KidSchema = z.string().min(1).max(64);
const Ed25519Base64 = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'expected 32 bytes of base64url');

export const Ed25519PublicJwkSchema = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: Ed25519Base64,
  kid: KidSchema,
  alg: z.literal('EdDSA').optional(),
  use: z.literal('sig').optional(),
});
export type Ed25519PublicJwk = z.infer<typeof Ed25519PublicJwkSchema>;

export const Ed25519PrivateJwkSchema = Ed25519PublicJwkSchema.extend({ d: Ed25519Base64 });
export type Ed25519PrivateJwk = z.infer<typeof Ed25519PrivateJwkSchema>;

/** A JWKS is public by definition: a key carrying `d` means a private key was published by mistake. */
const JwksKeySchema = Ed25519PublicJwkSchema.extend({ d: z.never().optional() });

export const JwksSchema = z
  .object({ keys: z.array(JwksKeySchema).min(1) })
  .refine((jwks) => new Set(jwks.keys.map((k) => k.kid)).size === jwks.keys.length, 'kids must be unique');
export type Jwks = z.infer<typeof JwksSchema>;

/** A private key ready to sign, with the key id that goes into every header. */
export interface Signer {
  key: CryptoKey;
  kid: string;
}

const ED25519 = { name: 'Ed25519' } as const;

function parseConfig<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  let input = value;
  if (typeof value === 'string') {
    try {
      input = JSON.parse(value);
    } catch {
      throw new HalynError('E_FAIL_CLOSED', `${what}: not JSON`);
    }
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', `${what}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Import Halyn's private Ed25519 JWK (object or the JSON string from an env var). Fails closed on anything else. */
export async function importSigningKey(privateJwk: unknown): Promise<Signer> {
  const jwk = parseConfig(Ed25519PrivateJwkSchema, privateJwk, 'importSigningKey');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d },
    ED25519,
    false,
    ['sign'],
  );
  return { key, kid: jwk.kid };
}

/** Import a JWKS (object or JSON string) into kid → verify key. */
export async function importVerifyKeys(jwks: unknown): Promise<ReadonlyMap<string, CryptoKey>> {
  const parsed = parseConfig(JwksSchema, jwks, 'importVerifyKeys');
  const entries = await Promise.all(
    parsed.keys.map(
      async (jwk) =>
        [
          jwk.kid,
          await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, ED25519, false, [
            'verify',
          ]),
        ] as const,
    ),
  );
  return new Map(entries);
}

// ── Compact JWS, EdDSA only ────────────────────────────────────────────────────────────────────────

export interface JwsHeader {
  alg: 'EdDSA';
  kid: string;
  typ: string;
}

const MAX_TOKEN_LENGTH = 8192;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Sign `canonicalJson(payload)` as a compact JWS. The payload bytes are canonical, so equal claims sign equally. */
export async function signCompactJws(
  header: JwsHeader,
  payload: unknown,
  privateKey: CryptoKey,
): Promise<string> {
  if (header.alg !== 'EdDSA') throw new HalynError('E_FAIL_CLOSED', 'signCompactJws: only EdDSA is allowed');
  const signingInput = `${base64urlEncode(utf8(canonicalJson(header)))}.${base64urlEncode(utf8(canonicalJson(payload)))}`;
  const signature = await crypto.subtle.sign(ED25519, privateKey, utf8(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}

export type VerifyJwsResult =
  | { ok: true; header: JwsHeader; payload: unknown }
  | { ok: false; reason: 'format' | 'header' | 'kid' | 'signature' | 'payload' };

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Verify a compact JWS against kid → key. Order: shape, header (alg EdDSA, the expected typ, a kid), key lookup,
 * signature — and only then the payload is parsed. Nothing in the payload is trusted before the signature checks out.
 */
export async function verifyCompactJws(
  token: unknown,
  keys: ReadonlyMap<string, CryptoKey>,
  typ: string,
): Promise<VerifyJwsResult> {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'format' };
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return { ok: false, reason: 'format' };
  const [h = '', p = '', s = ''] = parts;
  const headerBytes = base64urlDecode(h);
  const payloadBytes = base64urlDecode(p);
  const signature = base64urlDecode(s);
  if (!headerBytes || !payloadBytes || !signature) return { ok: false, reason: 'format' };

  const header = jwsHeaderSchema(typ).safeParse(parseJson(headerBytes));
  if (!header.success) return { ok: false, reason: 'header' };
  const key = keys.get(header.data.kid);
  if (!key) return { ok: false, reason: 'kid' };
  if (signature.length !== 64) return { ok: false, reason: 'signature' };
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(ED25519, key, signature, utf8(`${h}.${p}`));
  } catch {
    valid = false; // a key of the wrong type under a known kid: no throw escapes verification
  }
  if (!valid) return { ok: false, reason: 'signature' };
  const payload = parseJson(payloadBytes);
  if (payload === undefined) return { ok: false, reason: 'payload' };
  return { ok: true, header: header.data, payload };
}
