'use client';

import type { BolnaWebCall, CallState, Session } from '@bolna/web-call';
import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '@/lib/api/client';
import type { Copy } from '@/lib/i18n';

// "Call Aero" (docs/UI.md, Step 12): a browser call to the Aero voice agent through Bolna's Web Call SDK. The API
// mints the single-use session (POST /web/calls/session) and ties its run id to this signed-in customer, so the call
// carries the app session as proof. The region — the Stage's — picks the agent; no phone number is dialled.

export function CallAero({ api, copy }: { api: ApiClient; copy: Copy }) {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const call = useRef<BolnaWebCall | null>(null);

  useEffect(
    () => () => {
      void call.current?.stop();
    },
    [],
  );

  async function start() {
    setError(null);
    try {
      // Loaded on click: the SIP stack is browser-only and only needed for a call.
      const { BolnaWebCall } = await import('@bolna/web-call');
      const next = new BolnaWebCall({
        getSession: async () => (await api.webCallSession()) as unknown as Session,
      });
      next.on('state-change', setState);
      next.on('call-end', () => setState('idle'));
      next.on('error', () => setError(copy.callFailed));
      call.current = next;
      await next.start();
    } catch {
      setError(copy.callFailed);
      setState('idle');
    }
  }

  const live = state === 'connecting' || state === 'ringing' || state === 'active';
  return (
    <section aria-label={copy.callAero} className="rounded-3xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{copy.callAeroHint}</p>
      <div className="mt-3 flex items-center gap-3">
        {live ? (
          <>
            <span role="status" className="grow text-sm font-semibold text-primary">
              {state === 'active' ? copy.callActive : copy.callConnecting}
            </span>
            <button
              type="button"
              onClick={() => void call.current?.stop()}
              className="min-h-11 rounded-xl bg-coral px-4 text-sm font-bold text-foreground"
            >
              {copy.callHangUp}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            className="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
          >
            {copy.callAero}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
