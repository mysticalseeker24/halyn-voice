'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

// Every Console view loads once from the API and shows a loading, empty or error state (apps/web/CLAUDE.md).

export function Loaded<T>({
  load,
  isEmpty,
  empty,
  what,
  children,
}: {
  load: () => Promise<T>;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  /** "calls", "policies" … for the loading and error copy. */
  what: string;
  children: (data: T, reload: () => void) => ReactNode;
}) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }
  >({ status: 'loading' });
  const latest = useRef(load);
  latest.current = load;
  const alive = useRef(true);

  const reload = useCallback(() => {
    latest.current().then(
      (data) => alive.current && setState({ status: 'ready', data }),
      (err: unknown) =>
        alive.current &&
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : `Could not load ${what}.`,
        }),
    );
  }, [what]);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  if (state.status === 'loading') return <LoadingState label={`Loading ${what}…`} />;
  if (state.status === 'error')
    return (
      <ErrorState
        title={`Could not load ${what}`}
        message={state.message}
        retryLabel="Try again"
        onRetry={() => {
          setState({ status: 'loading' });
          reload();
        }}
      />
    );
  if (isEmpty?.(state.data)) return <EmptyState>{empty}</EmptyState>;
  return <>{children(state.data, reload)}</>;
}

export function Table({ head, children, label }: { head: string[]; children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-100 text-xs tracking-wide text-slate-600 uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export const cell = 'px-3 py-2 align-top';

/** A yes/no fact as a word (colour is never the only signal, docs/UI.md). */
export function Flag({ on, yes = 'ON', no = 'OFF' }: { on: boolean; yes?: string; no?: string }) {
  return (
    <span
      data-on={on}
      className={
        on
          ? 'rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white'
          : 'rounded bg-red-700 px-2 py-0.5 text-xs font-bold text-white'
      }
    >
      {on ? yes : no}
    </span>
  );
}
