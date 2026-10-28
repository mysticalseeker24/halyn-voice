'use client';

import type { Handoff } from '@halyn/shared';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import type { ApiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// Console Handoffs: every hold a specialist must look at. Release → Halyn approves the held action and executes it
// with a one-time grant; Block → it is refused. The first resolution wins. A coaching or distress hold also shows the
// check-in call booked for the customer (a record: nothing rings until a person decides to call).

const STATUS_STYLE: Record<Handoff['status'], string> = {
  open: 'bg-violet-700 text-white',
  released: 'bg-emerald-700 text-white',
  blocked: 'bg-red-700 text-white',
};

const WHEN = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

function when(iso: string): string {
  return `${WHEN.format(new Date(iso))} IST`;
}

export function HandoffsView({ api }: { api: ApiClient }) {
  const [handoffs, setHandoffs] = useState<Handoff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(
    () =>
      api.handoffs().then(
        (res) => {
          setHandoffs(res.handoffs);
          setError(null);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : 'Could not load handoffs.'),
      ),
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, action: 'release' | 'block') {
    setBusy(id);
    try {
      await api.resolveHandoff(id, action, notes[id]?.trim() || undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve the handoff.');
    } finally {
      setBusy(null);
    }
  }

  if (error && !handoffs)
    return (
      <ErrorState
        title="Could not load handoffs"
        message={error}
        retryLabel="Try again"
        onRetry={() => void load()}
      />
    );
  if (!handoffs) return <LoadingState label="Loading handoffs…" />;
  if (handoffs.length === 0)
    return <EmptyState>No handoffs yet. Holds appear here for a specialist.</EmptyState>;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {handoffs.map((h) => (
          <li key={h.id} data-testid="handoff" className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn('rounded px-2 py-0.5 text-xs font-bold', STATUS_STYLE[h.status])}>
                {h.status.toUpperCase()}
              </span>
              <p className="font-medium">{h.summary}</p>
            </div>
            <dl className="mt-3 grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Why</dt>
              <dd className="font-mono">{h.reasons.join(' · ')}</dd>
              <dt className="text-slate-500">Opened</dt>
              <dd>{when(h.created_at)}</dd>
              <dt className="text-slate-500">Call (transcript)</dt>
              <dd className="font-mono">{h.run_id}</dd>
              <dt className="text-slate-500">Request</dt>
              <dd className="font-mono">{h.request_id}</dd>
              {h.checkin ? (
                <>
                  <dt className="text-slate-500">Check-in call</dt>
                  <dd>
                    Scheduled {when(h.checkin.at)} ({h.checkin.why}) — not placed until someone calls
                  </dd>
                </>
              ) : null}
              {h.status !== 'open' && h.resolved_at ? (
                <>
                  <dt className="text-slate-500">Resolved</dt>
                  <dd>
                    {when(h.resolved_at)}
                    {h.note ? ` — ${h.note}` : ''}
                  </dd>
                </>
              ) : null}
            </dl>
            {h.status === 'open' ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="flex grow items-center gap-2 text-sm">
                  <span className="sr-only">Note for {h.id}</span>
                  <input
                    value={notes[h.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [h.id]: e.target.value }))}
                    maxLength={500}
                    placeholder="Note (optional)"
                    className="min-h-11 grow rounded-md border border-slate-300 px-3"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void resolve(h.id, 'release')}
                  className="min-h-11 rounded-md bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Release
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void resolve(h.id, 'block')}
                  className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Block
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
