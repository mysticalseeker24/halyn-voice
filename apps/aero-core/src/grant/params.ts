// The params a request asks Aero Core to execute: the query string for GET, the JSON body otherwise. They are hashed
// as read and must equal the grant's params_hash, so anything ambiguous (a repeated query key) or unreadable (bad JSON,
// invalid UTF-8, an oversized body) becomes `undefined`, which matches no grant (E_PARAMS_MISMATCH). Halyn's params are
// tiny. The body is read BEFORE the grant's signature can be checked (the hash needs it), so anyone who sends some
// x-halyn-grant header gets it read: it is capped in bytes as it streams in, and never buffered past the cap.

export const MAX_BODY_BYTES = 4096;

export async function readParams(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const params: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
      if (Object.hasOwn(params, key)) return undefined;
      params[key] = value;
    }
    return params;
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return undefined;
  const text = await readBodyText(request.body, MAX_BODY_BYTES);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The body as UTF-8 text, or `undefined` once more than `maxBytes` BYTES have arrived (the stream is cancelled: a
 * chunked body with no content-length is never buffered past the cap), when it is not valid UTF-8, or when a chunk is
 * not bytes or the stream fails. No body is the empty string.
 */
export async function readBodyText(
  body: ReadableStream<unknown> | null,
  maxBytes: number,
): Promise<string | undefined> {
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('the body is not bytes');
      size += value.byteLength;
      if (size > maxBytes) throw new RangeError('the body is over the cap');
      chunks.push(value);
    }
  } catch {
    // Stop reading: an oversized, non-byte or failed stream is unreadable. Cancelling may itself fail; that is fine.
    await reader.cancel().catch(() => undefined);
    return undefined;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // fatal: invalid UTF-8 throws instead of becoming U+FFFD. ignoreBOM false: a leading BOM is dropped, as text() does.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}
