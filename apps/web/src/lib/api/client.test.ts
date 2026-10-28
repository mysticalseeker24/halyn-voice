import { describe, expect, it, vi } from 'vitest';
import {
  aeroHome,
  approvalOptionsBody,
  jsonResponse,
  registerOptionsBody,
  sessionBody,
} from '@/test/fixtures';
import { ApiError, createApiClient } from './client';

const asFetch = (f: unknown) => f as typeof fetch;
const client = (fetchImpl: typeof fetch, token: string | null = 'tok') =>
  createApiClient({ baseUrl: 'http://api.test/', getToken: () => token, fetch: fetchImpl });

describe('api client', () => {
  it('sends the bearer token and parses the response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(aeroHome()));
    const home = await client(asFetch(fetchMock)).aeroHome();
    expect(home.customer.name).toBe('Saksham');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/web/aero/home');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('posts JSON bodies, validated by the shared schemas', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ test_run_id: 'run_1', scenario: '3', mode: 'text' }));
    const result = await client(asFetch(fetchMock)).stageRun('3');
    expect(result.scenario).toBe('3');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/web/stage/run/3');
    expect(init.body).toBe(JSON.stringify({ mode: 'text' }));
  });

  it('creates sessions without a token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(sessionBody()));
    const session = await client(asFetch(fetchMock), null).createCustomerSession('cus_saksham');
    expect(session.tenant_id).toBe('ten_aero');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('turns an error envelope into an ApiError with its reason code', async () => {
    const f = async () => jsonResponse({ error: { code: 'E_UNAUTHORIZED', message: 'Unauthorized' } }, 401);
    await expect(client(asFetch(f)).aeroHome()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'E_UNAUTHORIZED',
      status: 401,
    });
  });

  it('rejects a response that does not match its schema', async () => {
    const f = async () => jsonResponse({ customer: 'nope' });
    await expect(client(asFetch(f)).aeroHome()).rejects.toMatchObject({ code: 'E_BAD_RESPONSE' });
  });

  it('reports an unparseable error body and a network failure', async () => {
    const bad = async () => new Response('<html>', { status: 502 });
    await expect(client(asFetch(bad)).ledgerVerify()).rejects.toMatchObject({
      code: 'E_BAD_RESPONSE',
      status: 502,
    });
    const down = async () => {
      throw new TypeError('fetch failed');
    };
    const error = await client(asFetch(down))
      .ledger()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'E_NETWORK', status: 0 });
  });

  it('parses the ledger verify union', async () => {
    const f = async () => jsonResponse({ ok: false, entries: 4, first_bad_seq: 3 });
    await expect(client(asFetch(f)).ledgerVerify()).resolves.toEqual({
      ok: false,
      entries: 4,
      first_bad_seq: 3,
    });
  });

  it('covers the passkey, approval and region calls', async () => {
    const responses: Record<string, unknown> = {
      '/web/approvals/req_1/options': approvalOptionsBody(),
      '/web/approvals/req_1/verify': { ok: true, status: 'approved' },
      '/web/approvals/req_1/decline': { ok: true, status: 'declined' },
      '/web/passkeys/register/options': registerOptionsBody(),
      '/web/passkeys/register/verify': { ok: true },
      '/web/stage/region': { ok: true },
      '/web/session': sessionBody('console'),
    };
    const f = vi.fn(async (url: string) => jsonResponse(responses[new URL(url).pathname]));
    const api = client(asFetch(f));
    await api.approvalOptions('req_1');
    await expect(api.approvalVerify('req_1', { id: 'c' })).resolves.toMatchObject({ status: 'approved' });
    await expect(api.approvalDecline('req_1')).resolves.toMatchObject({ status: 'declined' });
    await api.passkeyRegisterOptions();
    await expect(api.passkeyRegisterVerify({ id: 'c' })).resolves.toEqual({ ok: true });
    await expect(api.stageRegion('US')).resolves.toEqual({ ok: true });
    await expect(api.createConsoleSession()).resolves.toMatchObject({ kind: 'console' });
  });
});

describe('demo access code', () => {
  it('sends x-demo-code on sign-in only, and only when there is one', async () => {
    const f = vi.fn(async () => jsonResponse(sessionBody()));
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getDemoCode: () => 'open-sesame',
      fetch: f as unknown as typeof fetch,
    });
    await api.createCustomerSession('cus_saksham');
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-demo-code']).toBe('open-sesame');

    const g = vi.fn(async () => jsonResponse(aeroHome()));
    const other = createApiClient({
      baseUrl: 'http://api.test',
      getDemoCode: () => 'open-sesame',
      fetch: g as unknown as typeof fetch,
    });
    await other.aeroHome();
    const [, init2] = g.mock.calls[0] as unknown as [string, RequestInit];
    expect((init2.headers as Record<string, string>)['x-demo-code']).toBeUndefined();

    const h = vi.fn(async () => jsonResponse(sessionBody('console')));
    const none = createApiClient({
      baseUrl: 'http://api.test',
      getDemoCode: () => null,
      fetch: h as unknown as typeof fetch,
    });
    await none.createConsoleSession();
    const [, init3] = h.mock.calls[0] as unknown as [string, RequestInit];
    expect((init3.headers as Record<string, string>)['x-demo-code']).toBeUndefined();
  });
});
