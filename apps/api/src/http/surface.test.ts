import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOLNA_IP, TOOL_SECRET, testEnv } from '../../test/fixtures/api';
import { createApp } from '../index';
import { cryptoRng } from '../platform/crypto-rng';
import { systemClock } from '../platform/clock';

// The API's whole HTTP surface, enumerated from the router itself, so a route added later without a guard (or with a
// wildcard CORS header) fails here instead of shipping.

const app = createApp({
  clock: systemClock,
  rng: cryptoRng,
  bolnaFetch: () => Promise.reject(new Error('no')),
});
const env = testEnv();
const ORIGIN = 'http://localhost:3000';

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

const concrete = (path: string) => path.replace(/:[A-Za-z_]+/g, 'x');
const routes = [
  ...new Map(
    app.routes
      .filter((r) => r.method !== 'ALL')
      .map((r) => [`${r.method} ${r.path}`, { method: r.method, path: concrete(r.path) }]),
  ).values(),
];
const bolnaRoutes = routes.filter((r) => /^\/(tools|webhooks)\//.test(r.path));
const webRoutes = routes.filter((r) => r.path.startsWith('/web/'));
const send = (r: { method: string; path: string }, headers: Record<string, string> = {}) =>
  app.request(
    r.path,
    {
      method: r.method,
      headers: { 'content-type': 'application/json', ...headers },
      body: r.method === 'POST' ? '{}' : undefined,
    },
    env,
  );

describe('the route table', () => {
  it('has only the routes we know: /health, the Bolna tools and webhook, /web/*, /ws', () => {
    const known = routes.filter((r) => !bolnaRoutes.includes(r) && !webRoutes.includes(r)).map((r) => r.path);
    expect(known.sort()).toEqual(['/health', '/ws']);
    expect(bolnaRoutes.map((r) => r.path).sort()).toEqual(
      [
        '/tools/check_decision',
        '/tools/confirm_result',
        '/tools/get_pass_code',
        '/tools/lookup_customer',
        '/tools/propose_action',
        '/tools/verify_pass',
        '/webhooks/bolna',
      ].sort(),
    );
  });
});

describe('Bolna-facing routes: source IP AND x-halyn-secret, on every one', () => {
  it.each(bolnaRoutes.map((r) => [r.method + ' ' + r.path, r] as const))(
    '%s refuses a missing secret, a wrong IP, a missing IP and a wrong secret',
    async (_, route) => {
      const good = { 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET };
      expect((await send(route, { 'cf-connecting-ip': BOLNA_IP })).status).toBe(401);
      expect((await send(route, { ...good, 'cf-connecting-ip': '203.0.113.9' })).status).toBe(401);
      expect((await send(route, { 'x-halyn-secret': TOOL_SECRET })).status).toBe(401);
      expect((await send(route, { ...good, 'x-halyn-secret': `${TOOL_SECRET}x` })).status).toBe(401);
      expect((await send(route, { ...good, 'x-halyn-secret': TOOL_SECRET.slice(0, -1) })).status).toBe(401);
      expect((await send(route, { ...good, 'x-halyn-secret': '' })).status).toBe(401);
      // A spoofed forwarding header does not stand in for the connecting IP.
      expect((await send(route, { 'x-forwarded-for': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET })).status).toBe(
        401,
      );
      // …while the real pair is let through to the handler (which then judges the body).
      expect((await send(route, good)).status).not.toBe(401);
    },
  );
});

describe('web routes: a session is required, and CORS is an allow-list (never *)', () => {
  it.each(
    // The two sign-in routes are public: each needs an access code instead (tested in session-route / judges tests).
    webRoutes
      .filter((r) => r.path !== '/web/session' && r.path !== '/web/judges/signup')
      .map((r) => [r.method + ' ' + r.path, r] as const),
  )('%s without a session is 401 and carries no wildcard CORS', async (_, route) => {
    const res = await send(route, { origin: ORIGIN });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it.each([
    ['another site', 'https://evil.test'],
    ['the null origin', 'null'],
    ['a prefix of the real one', 'http://localhost:30000'],
    ['a suffix attack', 'http://localhost:3000.evil.test'],
    ['another scheme', 'https://localhost:3000'],
    ['another case', 'HTTP://LOCALHOST:3000'],
    ['an empty origin', ''],
  ])('%s gets no Access-Control-Allow-Origin, on a preflight or a request', async (_, origin) => {
    const pre = await app.request(
      '/web/aero/home',
      { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET' } },
      env,
    );
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const res = await app.request('/web/me', { headers: { origin } }, env);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('the real origin is echoed exactly (never *), on success and on errors', async () => {
    for (const path of ['/web/me', '/web/aero/home', '/web/ledger']) {
      const res = await app.request(path, { headers: { origin: ORIGIN } }, env);
      expect(res.status).toBe(401);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    }
  });

  it('Bolna routes and /health never speak CORS, even to the real origin', async () => {
    for (const path of ['/health', '/tools/lookup_customer']) {
      const res = await app.request(
        path,
        {
          method: path === '/health' ? 'GET' : 'POST',
          headers: { origin: ORIGIN, 'cf-connecting-ip': BOLNA_IP, 'x-halyn-secret': TOOL_SECRET },
          body: path === '/health' ? undefined : '{}',
        },
        env,
      );
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});
