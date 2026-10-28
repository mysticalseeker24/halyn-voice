import {
  type Clock,
  CORE_RESPONSES,
  CORE_ROUTES,
  type CoreActionId,
  CoreOutcomeDetailsSchema,
  type CoreResponse,
  ErrorEnvelopeSchema,
  type ReasonCode,
} from '@halyn/shared';
import type { SignedGrant } from '../grants';

// The API's only way to Aero Core (docs/API.md "Aero Core" → "The API's core client must"). One request per signed
// grant, the exact params the grant hashes, and the answer read by its outcome, never by its status alone:
//   200                                     → executed (reads: the jti's reference; writes: the body's reference)
//   401 E_GRANT_REUSED + details executed   → executed EARLIER (only Halyn holds the grant): reconcile by reference
//   500 + details executed                  → executed (committed, answer lost)
//   500 + details unknown, 5xx, timeout,     → retry ONCE with the same grant while it is valid; still unknown →
//   network error, unreadable answer           `unknown` (the caller fails closed and reconciles later)
//   anything else without details           → refused: nothing executed (bank rule 400/404, grant refused 401)
// Never two grants for one effect: a retry reuses the same grant, so at most one execution can ever happen.

export type CoreTransport = (request: Request) => Promise<Response>;

/** Aero Core's origin for requests built here; a service binding ignores the host. */
export const CORE_ORIGIN = 'https://aero-core.internal';
const DEFAULT_TIMEOUT_MS = 5000;

export type CoreResult =
  | {
      status: 'executed';
      /** Speakable `AERO-XXXXXX` (writes from Aero Core; reads use the same form from the jti). */
      reference: string;
      /** False when Aero Core says this grant executed on an earlier attempt (no body then). */
      fresh: boolean;
      body: CoreResponse<CoreActionId> | null;
    }
  | { status: 'refused'; code: ReasonCode; http: number }
  | { status: 'unknown'; http: number | null };

/** The reference Aero Core gives a write: `AERO-` + the jti's last 6 characters. Reads get the same form. */
export function referenceFor(jti: string): string {
  return `AERO-${jti.slice(-6)}`;
}

export function buildCoreRequest(
  action: CoreActionId,
  params: Record<string, unknown>,
  token: string,
): Request {
  const route = CORE_ROUTES[action];
  const headers: Record<string, string> = { 'x-halyn-grant': token, accept: 'application/json' };
  if (route.method === 'GET') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      // GET actions only take string params (docs/ACTIONS.md); anything else could not hash the same on both sides.
      if (typeof value !== 'string') throw new TypeError(`core: GET param ${key} is not a string`);
      query.append(key, value);
    }
    return new Request(`${CORE_ORIGIN}${route.path}?${query.toString()}`, { method: 'GET', headers });
  }
  headers['content-type'] = 'application/json';
  return new Request(`${CORE_ORIGIN}${route.path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
}

type Attempt = CoreResult | { status: 'retry'; http: number | null };

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function attempt(
  transport: CoreTransport,
  action: CoreActionId,
  params: Record<string, unknown>,
  grant: SignedGrant,
  timeoutMs: number,
): Promise<Attempt> {
  let res: Response;
  try {
    const request = buildCoreRequest(action, params, grant.token);
    res = await transport(new Request(request, { signal: AbortSignal.timeout(timeoutMs) }));
  } catch (err) {
    if (err instanceof TypeError && err.message.startsWith('core: '))
      return { status: 'refused', code: 'E_FAIL_CLOSED', http: 0 };
    return { status: 'retry', http: null };
  }
  const body = await readJson(res);
  if (res.status === 200) {
    const parsed = CORE_RESPONSES[action].safeParse(body);
    const data = parsed.success ? (parsed.data as CoreResponse<CoreActionId>) : null;
    const reference = data && 'reference' in data ? data.reference : referenceFor(grant.claims.jti);
    return { status: 'executed', reference, fresh: true, body: data };
  }
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  const details = envelope.success ? CoreOutcomeDetailsSchema.safeParse(envelope.data.error.details) : null;
  if (details?.success) {
    if (details.data.outcome === 'executed')
      return { status: 'executed', reference: details.data.reference, fresh: false, body: null };
    return { status: 'retry', http: res.status };
  }
  if (!envelope.success || res.status >= 500) return { status: 'retry', http: res.status };
  // REUSED without its outcome hint contradicts the contract: Halyn cannot tell whether it executed.
  if (envelope.data.error.code === 'E_GRANT_REUSED') return { status: 'unknown', http: res.status };
  return { status: 'refused', code: envelope.data.error.code, http: res.status };
}

/**
 * Execute one granted action on Aero Core. Never throws. `presentedBefore`: this grant may already have reached Aero
 * Core (the Hub's sweep re-presenting a dead Worker's grant, ADR-020).
 */
export async function callCore(input: {
  transport: CoreTransport;
  grant: SignedGrant;
  action: CoreActionId;
  params: Record<string, unknown>;
  clock: Clock;
  timeoutMs?: number;
  presentedBefore?: boolean;
}): Promise<CoreResult> {
  const { transport, grant, action, params, clock } = input;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let last: Attempt = { status: 'retry', http: null };
  for (let i = 0; i < 2; i++) {
    // A retry only makes sense while Aero Core would still accept the grant.
    if (i > 0 && clock.nowMs() >= grant.claims.exp * 1000) break;
    last = await attempt(transport, action, params, grant, timeoutMs);
    // Aero Core checks expiry before the jti: on a grant that may have run already, EXPIRED cannot say "not executed".
    if (last.status === 'refused' && last.code === 'E_GRANT_EXPIRED' && (i > 0 || input.presentedBefore))
      return { status: 'unknown', http: last.http };
    if (last.status !== 'retry') return last;
  }
  return { status: 'unknown', http: last.status === 'retry' ? last.http : null };
}
