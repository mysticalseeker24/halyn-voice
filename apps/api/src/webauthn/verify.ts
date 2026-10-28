import {
  type AuthenticationCredentialJson,
  base64urlDecode,
  base64urlEncode,
  HalynError,
  type RegistrationCredentialJson,
  sha256Hex,
  timingSafeEqual,
  utf8,
} from '@halyn/shared';
import { z } from 'zod';
import type { CredentialRecord } from '../hub/types';
import { type Cbor, decodeCbor, decodeCborExact } from './cbor';

// Passkeys for the Aero app (WebAuthn Level 3, the server side; docs/API.md "Web"): registration with attestation
// "none" and assertions for the Confirm passkey leg. WebCrypto only: ES256 (P-256), EdDSA (Ed25519) and RS256. The
// attestation statement is not checked (we ask for "none": the passkey is bound to the customer by their session, not
// by a hardware vendor); everything else is — the challenge, origin, RP id hash, user presence AND verification, the
// credential id and key, the signature over authenticatorData ‖ SHA-256(clientDataJSON), and a growing sign count.

export type Alg = -7 | -8 | -257;

export interface Expected {
  /** base64url of the challenge Halyn issued (single use; the caller consumed it in the Hub). */
  challenge: string;
  /** Allowed page origins (WEB_ORIGIN). */
  origins: readonly string[];
  /** RP id (the web domain, RP_ID). */
  rpId: string;
}

function refuse(why: string): never {
  throw new HalynError('E_BAD_REQUEST', `The passkey could not be verified (${why})`);
}

function b64(text: string, what: string): Uint8Array<ArrayBuffer> {
  return base64urlDecode(text) ?? refuse(`${what} is not base64url`);
}

const ClientDataSchema = z.object({
  type: z.string(),
  challenge: z.string(),
  origin: z.string(),
  crossOrigin: z.boolean().optional(),
});

function clientData(bytes: Uint8Array, type: string, expected: Expected): void {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    refuse('client data is not JSON');
  }
  const parsed = ClientDataSchema.safeParse(json);
  if (!parsed.success) refuse('client data');
  const data = parsed.data;
  if (data.type !== type) refuse('ceremony type');
  if (!timingSafeEqual(data.challenge, expected.challenge)) refuse('challenge');
  if (!expected.origins.includes(data.origin)) refuse('origin');
  if (data.crossOrigin === true) refuse('cross-origin');
}

interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  credentialId: Uint8Array | null;
  publicKey: Cbor | null;
}

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

function parseAuthData(bytes: Uint8Array, withCredential: boolean): AuthData {
  if (bytes.length < 37) refuse('authenticator data too short');
  const flags = bytes[32] as number;
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0);
  const out: AuthData = {
    rpIdHash: bytes.slice(0, 32),
    flags,
    signCount,
    credentialId: null,
    publicKey: null,
  };
  if (!withCredential) return out;
  if ((flags & AT) === 0 || bytes.length < 55) refuse('no attested credential');
  const idLength = new DataView(bytes.buffer, bytes.byteOffset + 53, 2).getUint16(0);
  if (idLength < 16 || idLength > 1023 || 55 + idLength > bytes.length) refuse('credential id length');
  out.credentialId = bytes.slice(55, 55 + idLength);
  out.publicKey = decodeCbor(bytes, 55 + idLength).value;
  return out;
}

async function checkRpAndFlags(auth: AuthData, rpId: string): Promise<void> {
  const expected = await sha256Hex(utf8(rpId));
  const got = [...auth.rpIdHash].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!timingSafeEqual(got, expected)) refuse('RP id');
  if ((auth.flags & UP) === 0) refuse('user presence');
  if ((auth.flags & UV) === 0) refuse('user verification');
}

/** A COSE public key (RFC 9053) → JWK and algorithm. Only the three algorithms we offer. */
export function coseToJwk(cose: Cbor): { alg: Alg; jwk: Record<string, string> } {
  if (!(cose instanceof Map)) return refuse('public key');
  const bytes = (label: number) => {
    const value = cose.get(label);
    return value instanceof Uint8Array ? base64urlEncode(value) : refuse('public key field');
  };
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1)
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: bytes(-2), y: bytes(-3) } };
  if (kty === 1 && alg === -8 && cose.get(-1) === 6)
    return { alg: -8, jwk: { kty: 'OKP', crv: 'Ed25519', x: bytes(-2) } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: bytes(-1), e: bytes(-2) } };
  return refuse('unsupported key type or algorithm');
}

const PARAMS = {
  [-7]: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
  [-8]: { import: { name: 'Ed25519' }, verify: { name: 'Ed25519' } },
  [-257]: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
} as const;

export async function importPublicKey(alg: Alg, jwk: Record<string, unknown>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('jwk', jwk as unknown as JsonWebKey, PARAMS[alg].import, false, [
      'verify',
    ]);
  } catch {
    return refuse('public key does not import');
  }
}

/** ECDSA signatures arrive DER-encoded; WebCrypto wants r ‖ s, 32 bytes each. */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  const int = (offset: number): { value: Uint8Array; next: number } => {
    if (der[offset] !== 0x02) refuse('signature encoding');
    const length = der[offset + 1] as number;
    if (length < 1 || length > 33 || offset + 2 + length > der.length) refuse('signature encoding');
    let value = der.slice(offset + 2, offset + 2 + length);
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) refuse('signature encoding');
    return { value, next: offset + 2 + length };
  };
  if (der[0] !== 0x30 || der[1] !== der.length - 2) refuse('signature encoding');
  const r = int(2);
  const s = int(r.next);
  if (s.next !== der.length) refuse('signature encoding');
  const raw = new Uint8Array(64);
  raw.set(r.value, 32 - r.value.length);
  raw.set(s.value, 64 - s.value.length);
  return raw;
}

export interface RegisteredPasskey {
  id: string;
  alg: Alg;
  jwk: Record<string, string>;
  sign_count: number;
}

/** Verify `navigator.credentials.create()` for a challenge Halyn issued. */
export async function verifyRegistration(
  credential: RegistrationCredentialJson,
  expected: Expected,
): Promise<RegisteredPasskey> {
  if (credential.id !== credential.rawId) refuse('credential id');
  clientData(b64(credential.response.clientDataJSON, 'client data'), 'webauthn.create', expected);
  const attestation = decodeCborExact(b64(credential.response.attestationObject, 'attestation'));
  if (!(attestation instanceof Map)) return refuse('attestation object');
  const authBytes = attestation.get('authData');
  if (!(authBytes instanceof Uint8Array) || typeof attestation.get('fmt') !== 'string')
    refuse('attestation object');
  const auth = parseAuthData(authBytes, true);
  await checkRpAndFlags(auth, expected.rpId);
  const id = base64urlEncode(auth.credentialId as Uint8Array);
  if (id !== credential.rawId) refuse('credential id');
  const { alg, jwk } = coseToJwk(auth.publicKey);
  await importPublicKey(alg, jwk);
  return { id, alg, jwk, sign_count: auth.signCount };
}

/** Verify `navigator.credentials.get()` against a stored passkey; returns the new sign count to store. */
export async function verifyAuthentication(
  credential: AuthenticationCredentialJson,
  expected: Expected,
  stored: Pick<CredentialRecord, 'id' | 'alg' | 'jwk' | 'sign_count'>,
): Promise<{ sign_count: number }> {
  if (credential.id !== credential.rawId || credential.rawId !== stored.id) refuse('credential id');
  const clientBytes = b64(credential.response.clientDataJSON, 'client data');
  clientData(clientBytes, 'webauthn.get', expected);
  const authBytes = b64(credential.response.authenticatorData, 'authenticator data');
  const auth = parseAuthData(authBytes, false);
  await checkRpAndFlags(auth, expected.rpId);
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientBytes));
  const signed = new Uint8Array(authBytes.length + clientHash.length);
  signed.set(authBytes);
  signed.set(clientHash, authBytes.length);
  const alg = stored.alg;
  const key = await importPublicKey(alg, stored.jwk);
  const raw = b64(credential.response.signature, 'signature');
  const signature = alg === -7 ? derToRaw(raw) : raw;
  const valid = await crypto.subtle.verify(PARAMS[alg].verify, key, signature, signed).catch(() => false);
  if (!valid) refuse('signature');
  // A counter that does not grow means a cloned authenticator (0 forever is allowed: many passkeys never count).
  if ((auth.signCount > 0 || stored.sign_count > 0) && auth.signCount <= stored.sign_count)
    refuse('sign count');
  return { sign_count: auth.signCount };
}
