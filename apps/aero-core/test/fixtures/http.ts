import { CORE_ROUTES, type CoreActionId, fixedClock, type Rng } from '@halyn/shared';
import { createApp } from '../../src/app';
import { testEnv } from './env';

// Requests shaped the way Halyn's core client sends them: GET params in the query string, POST params as the JSON body.

export const BASE = 'https://core.aero.test';

export function coreRequest(
  action: CoreActionId,
  params: Record<string, unknown>,
  token?: string | null,
  init: { body?: string; headers?: Record<string, string> } = {},
): Request {
  const { method, path } = CORE_ROUTES[action];
  const headers: Record<string, string> = { ...init.headers };
  if (token) headers['x-halyn-grant'] = token;
  if (method === 'GET') {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return new Request(`${BASE}${path}?${query.toString()}`, { headers });
  }
  headers['content-type'] = 'application/json';
  return new Request(`${BASE}${path}`, { method, headers, body: init.body ?? JSON.stringify(params) });
}

export interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export async function reply<T = Record<string, unknown>>(
  response: Response | Promise<Response>,
): Promise<Reply<T>> {
  const res = await response;
  return { status: res.status, body: (await res.json()) as T };
}

/** mulberry32: deterministic bytes for tests. Not cryptographic. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    bytes(n: number): Uint8Array {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 4) {
        const v = next();
        for (let j = 0; j < 4 && i + j < n; j++) out[i + j] = (v >>> (8 * j)) & 0xff;
      }
      return out;
    },
  };
}

/** The app at a fixed instant (and a seeded rng), against the Miniflare D1 and the run's test keys. */
export function testApp(nowMs: number, seed = 1) {
  const app = createApp({ clock: fixedClock(nowMs), rng: seededRng(seed) });
  return (request: Request, env: unknown = testEnv()) => app.fetch(request, env as Env);
}
