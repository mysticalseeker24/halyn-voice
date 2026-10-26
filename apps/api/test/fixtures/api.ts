import { type SessionKind, signSession } from '../../src/auth/session';

// Shared helpers for the API's unit and integration tests. Secrets match the miniflare bindings in vitest.config.ts.

export const TOOL_SECRET = 'test-tool-secret-0123456789abcdef0123456789';
export const SESSION_SECRET = 'test-session-secret-0123456789abcdef01234567';
export const BOLNA_IP = '13.203.39.153';
export const TENANT = 'ten_aero';

/** A complete, valid Worker env for `app.request(path, init, env)` (bindings stubbed where a test doesn't use them). */
export function testEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    DEFAULT_TENANT_ID: TENANT,
    BOLNA_SOURCE_IPS: '13.203.39.153,13.126.9.249,13.202.133.53',
    WEB_ORIGIN: 'http://localhost:3000',
    RP_ID: 'localhost',
    HALYN_TOOL_SECRET: TOOL_SECRET,
    SESSION_SECRET,
    ...overrides,
  } as unknown as Env;
}

export async function sessionToken(
  kind: SessionKind,
  customer_id: string | null = kind === 'customer' ? 'cus_saksham' : null,
  nowMs = Date.now(),
  tenant_id = TENANT,
): Promise<string> {
  return (await signSession({ tenant_id, kind, customer_id }, SESSION_SECRET, nowMs)).token;
}

let counter = 0;
/** A fresh tenant per test, so each gets its own Hub. */
export function uniqueTenant(): string {
  counter += 1;
  return `ten_t${Date.now().toString(36)}${counter}`;
}
