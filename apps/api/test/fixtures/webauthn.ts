// A software passkey for tests (an "authenticator" in the WebAuthn sense): it registers and signs exactly like a
// browser would hand the result to the API, so the server-side checks run unmodified. ES256 or EdDSA.
import {
  type AuthenticationCredentialJson,
  base64urlEncode,
  type CreationOptionsJson,
  type RegistrationCredentialJson,
  type RequestOptionsJson,
  utf8,
} from '@halyn/shared';

type CborIn = number | string | Uint8Array | CborIn[] | Map<CborIn, CborIn> | { [k: string]: CborIn };

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** A minimal CBOR encoder (test only). */
export function encodeCbor(value: CborIn): Uint8Array {
  const out: number[] = [];
  const write = (v: CborIn): void => {
    if (typeof v === 'number') out.push(...(v >= 0 ? head(0, v) : head(1, -1 - v)));
    else if (typeof v === 'string') {
      const bytes = utf8(v);
      out.push(...head(3, bytes.length), ...bytes);
    } else if (v instanceof Uint8Array) out.push(...head(2, v.length), ...v);
    else if (Array.isArray(v)) {
      out.push(...head(4, v.length));
      v.forEach(write);
    } else {
      const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
      out.push(...head(5, entries.length));
      for (const [k, x] of entries) {
        write(k);
        write(x);
      }
    }
  };
  write(value);
  return Uint8Array.from(out);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** P1363 r ‖ s (WebCrypto) → DER, as authenticators send ECDSA signatures. */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if ((v[0] as number) & 0x80) v = concat(Uint8Array.of(0), v);
    return concat(Uint8Array.of(0x02, v.length), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

export interface SoftPasskey {
  id: string;
  alg: -7 | -8;
  register(options: CreationOptionsJson, origin: string, flags?: number): Promise<RegistrationCredentialJson>;
  authenticate(
    options: RequestOptionsJson,
    origin: string,
    tamper?: { flags?: number; counter?: number; rpId?: string; type?: string },
  ): Promise<AuthenticationCredentialJson>;
}

export async function softPasskey(alg: -7 | -8 = -7): Promise<SoftPasskey> {
  const algorithm = alg === -7 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'Ed25519' };
  const pair = (await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const b = (s: string | undefined) =>
    Uint8Array.from(atob((s ?? '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const cose =
    alg === -7
      ? new Map<CborIn, CborIn>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, b(jwk.x)],
          [-3, b(jwk.y)],
        ])
      : new Map<CborIn, CborIn>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, b(jwk.x)],
        ]);
  const rawId = crypto.getRandomValues(new Uint8Array(32));
  const id = base64urlEncode(rawId);
  let counter = 0;
  const counterBytes = (n: number) =>
    Uint8Array.of((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);

  return {
    id,
    alg,
    async register(options, origin, flags = 0x45) {
      const clientData = utf8(
        JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }),
      );
      const authData = concat(
        await sha256(utf8(options.rp.id)),
        Uint8Array.of(flags),
        counterBytes(counter),
        new Uint8Array(16),
        Uint8Array.of(rawId.length >> 8, rawId.length & 0xff),
        rawId,
        encodeCbor(cose),
      );
      const attestationObject = encodeCbor({ fmt: 'none', attStmt: {}, authData });
      return {
        id,
        rawId: id,
        type: 'public-key',
        response: {
          clientDataJSON: base64urlEncode(clientData),
          attestationObject: base64urlEncode(attestationObject),
        },
      };
    },
    async authenticate(options, origin, tamper = {}) {
      counter = tamper.counter ?? counter + 1;
      const clientData = utf8(
        JSON.stringify({
          type: tamper.type ?? 'webauthn.get',
          challenge: options.challenge,
          origin,
          crossOrigin: false,
        }),
      );
      const authData = concat(
        await sha256(utf8(tamper.rpId ?? options.rpId)),
        Uint8Array.of(tamper.flags ?? 0x05),
        counterBytes(counter),
      );
      const signed = concat(authData, await sha256(clientData));
      const sig = new Uint8Array(
        await crypto.subtle.sign(
          alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'Ed25519' },
          pair.privateKey,
          signed,
        ),
      );
      return {
        id,
        rawId: id,
        type: 'public-key',
        response: {
          clientDataJSON: base64urlEncode(clientData),
          authenticatorData: base64urlEncode(authData),
          signature: base64urlEncode(alg === -7 ? rawToDer(sig) : sig),
          userHandle: null,
        },
      };
    },
  };
}
