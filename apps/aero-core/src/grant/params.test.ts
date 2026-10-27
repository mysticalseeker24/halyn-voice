import { utf8 } from '@halyn/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, readBodyText, readParams } from './params';

// What a route hashes and executes: the query string (GET) or the JSON body (POST), exactly. Anything ambiguous or
// unreadable becomes `undefined`, which can match no grant (E_PARAMS_MISMATCH). The body is read before the grant's
// signature is checked, so it is capped in BYTES as it streams in: an oversized body is never buffered.

const url = 'https://core.aero.test/core/x';

describe('readParams', () => {
  it('GET: the query string as an object of strings', async () => {
    expect(await readParams(new Request(`${url}?account=savings`))).toEqual({ account: 'savings' });
    expect(await readParams(new Request(url))).toEqual({});
  });

  it('GET: a repeated key is ambiguous → undefined', async () => {
    expect(await readParams(new Request(`${url}?account=savings&account=current`))).toBeUndefined();
  });

  it('POST: the JSON body as sent', async () => {
    const body = { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' };
    expect(await readParams(post(JSON.stringify(body)))).toEqual(body);
  });

  it.each([
    ['invalid JSON', post('{nope')],
    ['an empty body', post('')],
    ['a declared length over the limit', post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) })],
    ['an actual body over the limit', post(JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) }))],
  ])('POST: %s → undefined', async (_, request) => {
    expect(await readParams(request)).toBeUndefined();
  });

  it('POST: a chunked body that never ends (no content-length) → undefined, without reading it all', async () => {
    const request = new Request(url, { method: 'POST', body: endless().stream });
    expect(request.headers.get('content-length')).toBeNull();
    expect(await readParams(request)).toBeUndefined();
  });

  // 'é' is 2 bytes in UTF-8 but 1 UTF-16 unit: a cap on string length would let 4 KB of characters be ~8 KB of bytes.
  const pad = (n: number, tail = '') => `{"pad":"${'é'.repeat(n)}${tail}"}`;
  const AT_CAP = pad(2043); // 10 + 2 × 2043 = 4096 bytes, 2053 UTF-16 units
  const OVER_CAP = pad(2043, 'a'); // 4097 bytes, 2054 UTF-16 units

  it('POST: the cap counts bytes, not UTF-16 units (multibyte body at and just over 4,096 bytes)', async () => {
    expect([utf8(AT_CAP).byteLength, utf8(OVER_CAP).byteLength]).toEqual([
      MAX_BODY_BYTES,
      MAX_BODY_BYTES + 1,
    ]);
    expect(OVER_CAP.length).toBeLessThan(MAX_BODY_BYTES);
    expect(await readParams(streamed([utf8(AT_CAP)]))).toEqual({ pad: 'é'.repeat(2043) });
    expect(await readParams(streamed([utf8(OVER_CAP)]))).toBeUndefined();
    expect(await readParams(post(AT_CAP))).toEqual({ pad: 'é'.repeat(2043) });
    expect(await readParams(post(OVER_CAP))).toBeUndefined();
  });

  it('POST: invalid UTF-8 → undefined (never silently replaced with U+FFFD)', async () => {
    const bytes = new Uint8Array([...utf8('{"a":"'), 0xff, ...utf8('"}')]);
    expect(await readParams(streamed([bytes]))).toBeUndefined();
    const truncated = utf8('{"a":"é"}').slice(0, 7); // ends inside the 2-byte 'é'
    expect(await readParams(streamed([truncated]))).toBeUndefined();
  });

  it('POST: a character split across chunks still decodes', async () => {
    const bytes = utf8('{"a":"é"}');
    expect(await readParams(streamed([bytes.slice(0, 7), bytes.slice(7)]))).toEqual({ a: 'é' });
  });
});

describe('readBodyText', () => {
  it('stops at the cap and cancels the stream: an endless body is never buffered', async () => {
    const source = endless();
    expect(await readBodyText(source.stream, MAX_BODY_BYTES)).toBeUndefined();
    expect(source.cancelled()).toBe(true);
    expect(source.pulled()).toBeLessThanOrEqual(MAX_BODY_BYTES + 2 * 1024);
  });

  it('no body → empty text', async () => {
    expect(await readBodyText(null, MAX_BODY_BYTES)).toBe('');
  });

  it.each([
    ['a chunk that is not bytes', new ReadableStream({ start: (c) => (c.enqueue('{}'), c.close()) })],
    ['a stream that fails', new ReadableStream({ pull: (c) => c.error(new Error('client went away')) })],
  ])('%s → undefined', async (_, stream) => {
    expect(await readBodyText(stream, MAX_BODY_BYTES)).toBeUndefined();
  });

  it('property: any text in any chunking reads back exactly iff its UTF-8 is within the cap', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: 'binary', maxLength: 2600 }),
        fc.array(fc.nat(), { maxLength: 6 }),
        async (text, cuts) => {
          const bytes = utf8(text);
          const points = [...new Set(cuts.map((c) => c % (bytes.byteLength + 1)))].sort((a, b) => a - b);
          const chunks = [0, ...points].map((start, i) => bytes.slice(start, points[i] ?? bytes.byteLength));
          const read = await readBodyText(streamOf(chunks), MAX_BODY_BYTES);
          expect(read).toBe(bytes.byteLength <= MAX_BODY_BYTES ? new TextDecoder().decode(bytes) : undefined);
        },
      ),
      { seed: 20261027, numRuns: 120 },
    );
  });
});

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) if (chunk.byteLength > 0) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** A POST whose body streams in (chunked: no content-length). */
function streamed(chunks: Uint8Array[]): Request {
  return new Request(url, { method: 'POST', body: streamOf(chunks) });
}

/** A body that never ends, 1 KB per pull; records how much was pulled and whether the reader cancelled. */
function endless() {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1024;
      controller.enqueue(new Uint8Array(1024).fill(0x20));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, pulled: () => pulled, cancelled: () => cancelled };
}
