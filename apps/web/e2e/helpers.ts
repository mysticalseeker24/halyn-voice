import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page, Route, WebSocketRoute } from '@playwright/test';

// The API (Step 7) is built in parallel, so e2e runs against a mocked API at NEXT_PUBLIC_API_URL's default.
export const API = 'http://localhost:8787';

export const SCREENS_DIR = path.resolve(process.cwd(), '../../docs/screens');

export function screenshotPath(name: string): string {
  mkdirSync(SCREENS_DIR, { recursive: true });
  return path.join(SCREENS_DIR, `${name}.png`);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-demo-code',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

export async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const wsTicket: ApiHandler = (route) =>
  json(route, {
    ticket: 'ten_aero.' + 'e2e-ticket-'.repeat(4),
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  });

export type ApiHandler = (route: Route, body: unknown) => Promise<void> | void;

/** Routes every call to the mocked API by "METHOD /path"; answers CORS preflights; 404s anything unmocked. */
export async function mockApi(page: Page, handlers: Record<string, ApiHandler>): Promise<void> {
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    // Every page asks for a one-time Hub ticket before opening /ws (ADR-021).
    const handler = handlers[key] ?? (key === 'POST /web/ws-ticket' ? wsTicket : undefined);
    if (!handler) {
      await json(route, { error: { code: 'E_NOT_FOUND', message: `unmocked ${key}` } }, 404);
      return;
    }
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = undefined;
    }
    await handler(route, body);
  });
}

/** Captures the Hub socket the page opens, so a test can push messages as the Hub would. */
export async function mockHub(page: Page): Promise<{ next: () => Promise<WebSocketRoute> }> {
  const waiting: ((ws: WebSocketRoute) => void)[] = [];
  const opened: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\?/, (ws) => {
    const resolve = waiting.shift();
    if (resolve) resolve(ws);
    else opened.push(ws);
  });
  return {
    next: () =>
      new Promise<WebSocketRoute>((resolve) => {
        const ws = opened.shift();
        if (ws) resolve(ws);
        else waiting.push(resolve);
      }),
  };
}

/** A virtual authenticator that supports discoverable credentials and auto-verifies the user. */
export async function addVirtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
