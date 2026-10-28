import { base64urlDecode, base64urlEncode, HalynError, type HubRole, type Rng, utf8 } from '@halyn/shared';
import { hmacKey, type SessionKind } from './session';

// One-time WebSocket tickets (ADR-021). A browser cannot set headers on a WebSocket, and a session token in a URL may
// be kept by edge logs, so the app trades its session for a ticket first (POST /web/ws-ticket) and opens the socket
// with it (GET /ws?ticket=…&role=…). The tenant's Hub issues the ticket body — `<tenant>.<32 random bytes>` — keeps
// only its SHA-256 with the session kind, customer, role and a 30 s expiry, and accepts it once. The Worker seals the
// body with an HMAC (SESSION_SECRET), so /ws only ever routes a ticket the API issued to its own tenant's Hub, and a
// forged or re-labelled ticket is refused before any Hub is woken.

export const WS_TICKET_TTL_MS = 30_000;

/** Which Hub roles each kind of session may listen as. */
export const WS_ROLES: Record<SessionKind, readonly HubRole[]> = {
  customer: ['aero', 'assistant'],
  console: ['stage', 'console'],
};

export function roleAllowed(kind: SessionKind, role: HubRole): boolean {
  return WS_ROLES[kind].includes(role);
}

const PART = '[A-Za-z0-9_-]{43}'; // 32 bytes, base64url
const TENANT = 'ten_[A-Za-z0-9_]{1,60}';
const BODY = new RegExp(`^${TENANT}\\.${PART}$`);
const TICKET = new RegExp(`^(${TENANT})\\.(${PART})\\.(${PART})$`);
const MAX_TICKET_LENGTH = 200;
/** Domain separation: no session signing input (`<b64>.<b64>`) can ever equal a ticket's MAC input. */
const DOMAIN = 'halyn-ws-ticket/1:';

/** A fresh ticket body for this tenant (the Hub's rng). */
export function newTicketBody(tenant: string, rng: Rng): string {
  const body = `${tenant}.${base64urlEncode(rng.bytes(32))}`;
  if (!BODY.test(body)) throw new HalynError('E_FAIL_CLOSED', 'ws-ticket: invalid tenant');
  return body;
}

/** `<body>.<HMAC-SHA256(SESSION_SECRET, domain ‖ body)>` — what the app receives. */
export async function sealTicket(body: string, secret: string): Promise<string> {
  if (!BODY.test(body)) throw new HalynError('E_FAIL_CLOSED', 'ws-ticket: invalid ticket body');
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(DOMAIN + body));
  return `${body}.${base64urlEncode(new Uint8Array(mac))}`;
}

/** The tenant and the body of a ticket this API sealed, or null for anything malformed or forged. */
export async function openTicket(
  ticket: unknown,
  secret: string,
): Promise<{ tenant: string; body: string } | null> {
  if (typeof ticket !== 'string' || ticket.length > MAX_TICKET_LENGTH) return null;
  const match = TICKET.exec(ticket);
  if (!match) return null;
  const [, tenant = '', random = '', mac = ''] = match;
  const signature = base64urlDecode(mac);
  if (!signature || signature.length !== 32) return null;
  const body = `${tenant}.${random}`;
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, utf8(DOMAIN + body));
  return valid ? { tenant, body } : null;
}
