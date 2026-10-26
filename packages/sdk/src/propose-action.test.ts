import { describe, expect, it } from 'vitest';
import { type ProposeActionInput, proposeAction } from './propose-action';

const REQUEST: ProposeActionInput = {
  run_id: 'run-1',
  from_number: '+918065356344',
  channel: 'phone',
  action: 'card.freeze',
  params: { card_last4: '8812' },
  readback_confirmed: true,
  caller_quotes: ['please freeze my card'],
};

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}) {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe('proposeAction', () => {
  it('posts the validated request with the shared secret and returns the pending request id', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const result = await proposeAction(
      {
        baseUrl: 'https://api.halyn.test/',
        secret: 's3cret',
        fetch: fakeFetch(200, { request_id: 'req_1', status: 'pending' }, seen),
      },
      REQUEST,
    );
    expect(result).toEqual({ ok: true, value: { request_id: 'req_1', status: 'pending' } });
    expect(seen.url).toBe('https://api.halyn.test/tools/propose_action');
    expect(seen.init?.method).toBe('POST');
    expect(new Headers(seen.init?.headers).get('x-halyn-secret')).toBe('s3cret');
    expect(JSON.parse(String(seen.init?.body))).toMatchObject({
      action: 'card.freeze',
      caller_quotes: ['please freeze my card'],
    });
  });

  it('refuses an invalid request without calling the network', async () => {
    const seen: { url?: string } = {};
    const result = await proposeAction(
      { baseUrl: 'https://api.halyn.test', secret: 's', fetch: fakeFetch(200, {}, seen) },
      { ...REQUEST, channel: 'fax' } as never,
    );
    expect(result).toMatchObject({ ok: false, status: 0, error: { code: 'E_FAIL_CLOSED' } });
    expect(seen.url).toBeUndefined();
  });

  it('returns the error envelope on a non-2xx answer', async () => {
    const error = { error: { code: 'E_FAIL_CLOSED', message: 'nope' } };
    expect(
      await proposeAction({ baseUrl: 'https://a', secret: 's', fetch: fakeFetch(401, error) }, REQUEST),
    ).toEqual({
      ok: false,
      status: 401,
      error: error.error,
    });
    expect(
      await proposeAction({ baseUrl: 'https://a', secret: 's', fetch: fakeFetch(500, 'oops') }, REQUEST),
    ).toEqual({
      ok: false,
      status: 500,
      error: null,
    });
  });

  it('treats an unexpected 2xx body or a network failure as a failure', async () => {
    expect(
      await proposeAction(
        { baseUrl: 'https://a', secret: 's', fetch: fakeFetch(200, { status: 'done' }) },
        REQUEST,
      ),
    ).toEqual({ ok: false, status: 200, error: null });
    const failing = (async () => {
      throw new TypeError('network down');
    }) as typeof fetch;
    expect(await proposeAction({ baseUrl: 'https://a', secret: 's', fetch: failing }, REQUEST)).toEqual({
      ok: false,
      status: 0,
      error: null,
    });
  });

  it('uses the global fetch when none is injected', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch(200, { request_id: 'req_2', status: 'pending' });
    try {
      expect(await proposeAction({ baseUrl: 'https://a', secret: 's' }, REQUEST)).toMatchObject({ ok: true });
    } finally {
      globalThis.fetch = original;
    }
  });
});
