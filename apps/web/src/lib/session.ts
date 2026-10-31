'use client';

import { SessionResponseSchema } from '@halyn/shared';
import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { ApiError, type ApiClient, createApiClient } from '@/lib/api/client';

type Session = z.infer<typeof SessionResponseSchema>;
export type SessionKind = { kind: 'customer'; customerId: string } | { kind: 'console' };

export type SessionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** POST /web/session refused the visit: the API wants (or did not accept) the demo access code. */
  | { status: 'needs_code'; rejected: boolean }
  | { status: 'ready'; session: Session };

export const DEMO_CUSTOMER_ID = 'cus_saksham';
const JUDGE_CUSTOMER_KEY = 'halyn.customer';

/**
 * The customer the Aero and Assistant apps act as: a judge who signed up at /try on this device (their own demo
 * customer, pitch deck slide 13), else the demo customer.
 */
export function demoCustomerId(): string {
  try {
    const id = typeof window === 'undefined' ? null : window.localStorage.getItem(JUDGE_CUSTOMER_KEY);
    return id && /^cus_judge_[A-Za-z0-9]+$/.test(id) ? id : DEMO_CUSTOMER_ID;
  } catch {
    return DEMO_CUSTOMER_ID;
  }
}

/** After /try: remember the code (this tab) and the judge's customer (this device), and cache their session. */
export function storeJudgeSession(code: string, session: Session): void {
  storeDemoCode(code.trim());
  if (session.customer_id === null) return;
  try {
    window.localStorage.setItem(JUDGE_CUSTOMER_KEY, session.customer_id);
    window.sessionStorage.setItem(`halyn.session.${session.customer_id}`, JSON.stringify(session));
  } catch {
    // Private window: the Aero app asks for the code again and signs in as this customer from the cached id.
  }
}

/** Back to the demo customer on this device. */
export function forgetJudge(): void {
  try {
    window.localStorage.removeItem(JUDGE_CUSTOMER_KEY);
  } catch {
    // Nothing stored.
  }
}

// One browser tab holds one demo session at a time; the API client reads its token from here.
let currentToken: string | null = null;
const DEMO_CODE_KEY = 'halyn.demo-code';

// The demo access code lives only in this tab's sessionStorage (typed by the viewer), never in the bundle or an env var.
function readDemoCode(): string | null {
  try {
    return window.sessionStorage.getItem(DEMO_CODE_KEY);
  } catch {
    return null;
  }
}
let memoryCode: string | null = null;
const getDemoCode = () => readDemoCode() ?? memoryCode;
function storeDemoCode(code: string | null): void {
  memoryCode = null;
  try {
    if (code === null) window.sessionStorage.removeItem(DEMO_CODE_KEY);
    else window.sessionStorage.setItem(DEMO_CODE_KEY, code);
  } catch {
    memoryCode = code; // Private window: kept in memory for this page only.
  }
}

const api: ApiClient = createApiClient({ getToken: () => currentToken, getDemoCode });

function cacheKey(kind: SessionKind): string {
  return kind.kind === 'customer' ? `halyn.session.${kind.customerId}` : 'halyn.session.console';
}

/**
 * A cached session is used only if it still parses as a session for this visitor and has more than a minute left;
 * anything else (edited, stale, another customer's) means a fresh sign-in.
 */
export function parseCachedSession(raw: string | null, kind: SessionKind, nowMs: number): Session | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = SessionResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const session = parsed.data;
  if (session.kind !== kind.kind) return null;
  if (kind.kind === 'customer' && session.customer_id !== kind.customerId) return null;
  return Date.parse(session.expires_at) - nowMs > 60_000 ? session : null;
}

function readCached(key: string, kind: SessionKind): Session | null {
  try {
    return parseCachedSession(window.sessionStorage.getItem(key), kind, Date.now());
  } catch {
    return null;
  }
}

/**
 * Demo login (docs/API.md): customer or console session, cached in sessionStorage until it nearly expires.
 * Returns an API client that attaches the token.
 */
export function useDemoSession(kind: SessionKind): {
  state: SessionState;
  api: ApiClient;
  token: string | null;
  retry: () => void;
  /** Stores the typed demo access code and signs in again. */
  submitCode: (code: string) => void;
} {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = cacheKey(kind);
  const customerId = kind.kind === 'customer' ? kind.customerId : null;

  useEffect(() => {
    let cancelled = false;
    const cached = readCached(key, customerId ? { kind: 'customer', customerId } : { kind: 'console' });
    const login: Promise<Session> = cached
      ? Promise.resolve(cached)
      : customerId
        ? api.createCustomerSession(customerId)
        : api.createConsoleSession();
    login.then(
      (session) => {
        if (cancelled) return;
        currentToken = session.token;
        if (!cached) {
          try {
            window.sessionStorage.setItem(key, JSON.stringify(session));
          } catch {
            // Private window: the session simply is not remembered.
          }
        }
        setState({ status: 'ready', session });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === 'E_UNAUTHORIZED' && error.status === 401) {
          const rejected = getDemoCode() !== null;
          if (rejected) storeDemoCode(null);
          setState({ status: 'needs_code', rejected });
          return;
        }
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Sign-in failed.' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, customerId, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  const submitCode = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    storeDemoCode(trimmed);
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return { state, api, token: state.status === 'ready' ? state.session.token : null, retry, submitCode };
}
