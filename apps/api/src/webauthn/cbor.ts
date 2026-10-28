import { HalynError } from '@halyn/shared';

// A small, strict CBOR decoder (RFC 8949) for exactly what WebAuthn sends: attestation objects and COSE keys.
// Definite lengths only (CTAP2 canonical CBOR), no tags, no floats, bounded depth and sizes. Anything else fails
// closed. WebCrypto-only Workers have no CBOR library; this keeps the passkey check dependency-free and cheap.

export type Cbor = number | string | boolean | null | undefined | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

const MAX_DEPTH = 8;
const MAX_ITEMS = 256;

function fail(why: string): never {
  throw new HalynError('E_BAD_REQUEST', `The passkey data is malformed (${why})`);
}

class Reader {
  constructor(
    private readonly bytes: Uint8Array,
    public offset: number,
  ) {}

  byte(): number {
    if (this.offset >= this.bytes.length) fail('truncated');
    return this.bytes[this.offset++] as number;
  }

  take(n: number): Uint8Array {
    if (n < 0 || this.offset + n > this.bytes.length) fail('truncated');
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  length(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.byte();
    if (additional === 25) return (this.byte() << 8) | this.byte();
    if (additional === 26)
      return ((this.byte() << 24) >>> 0) + ((this.byte() << 16) | (this.byte() << 8) | this.byte());
    if (additional === 27) {
      const high = ((this.byte() << 24) >>> 0) + ((this.byte() << 16) | (this.byte() << 8) | this.byte());
      const low = ((this.byte() << 24) >>> 0) + ((this.byte() << 16) | (this.byte() << 8) | this.byte());
      const value = high * 2 ** 32 + low;
      if (!Number.isSafeInteger(value)) fail('integer too large');
      return value;
    }
    return fail('indefinite or reserved length');
  }

  item(depth: number): Cbor {
    if (depth > MAX_DEPTH) fail('nested too deeply');
    const initial = this.byte();
    const major = initial >> 5;
    const additional = initial & 0x1f;
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
      if (additional === 23) return undefined;
      return fail('unsupported simple value');
    }
    const n = this.length(additional);
    switch (major) {
      case 0:
        return n;
      case 1:
        return -1 - n;
      case 2:
        return this.take(n);
      case 3:
        try {
          return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(this.take(n));
        } catch (err) {
          if (err instanceof HalynError) throw err;
          return fail('invalid UTF-8');
        }
      case 4: {
        if (n > MAX_ITEMS) fail('array too long');
        const out: Cbor[] = [];
        for (let i = 0; i < n; i++) out.push(this.item(depth + 1));
        return out;
      }
      case 5: {
        if (n > MAX_ITEMS) fail('map too long');
        const out = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) {
          const key = this.item(depth + 1);
          if (typeof key !== 'number' && typeof key !== 'string') fail('map key');
          if (out.has(key)) fail('duplicate map key');
          out.set(key, this.item(depth + 1));
        }
        return out;
      }
      default:
        return fail('tags are not supported');
    }
  }
}

/** Decode one CBOR item starting at `offset`; `end` is where the next byte after it is. */
export function decodeCbor(bytes: Uint8Array, offset = 0): { value: Cbor; end: number } {
  const reader = new Reader(bytes, offset);
  const value = reader.item(0);
  return { value, end: reader.offset };
}

/** Decode a buffer that holds exactly one CBOR item. */
export function decodeCborExact(bytes: Uint8Array): Cbor {
  const { value, end } = decodeCbor(bytes);
  if (end !== bytes.length) fail('trailing bytes');
  return value;
}
