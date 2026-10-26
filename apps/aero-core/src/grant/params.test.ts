import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, readParams } from './params';

// What a route hashes and executes: the query string (GET) or the JSON body (POST), exactly. Anything ambiguous or
// unreadable becomes `undefined`, which can match no grant (E_PARAMS_MISMATCH).

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
});

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
