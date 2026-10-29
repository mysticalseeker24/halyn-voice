'use client';

import { type ReactNode, useCallback, useEffect, useEffectEvent, useState } from 'react';
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
  // Each reload bumps the nonce; the effect reads the latest `load` without re-running when its identity changes.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const fetchData = useEffectEvent((alive: { current: boolean }) =>
    load().then(
      (data) => alive.current && setState({ status: 'ready', data }),
      (err: unknown) =>
        alive.current &&
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : `Could not load ${what}.`,
        }),
    ),
  );

  useEffect(() => {
    const alive = { current: true };
    void fetchData(alive);
    return () => {
      alive.current = false;
    };
  }, [nonce]);

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
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/60 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export const cell = 'px-4 py-3 align-top';

/** A yes/no fact as a word (colour is never the only signal, docs/UI.md). */
export function Flag({ on, yes = 'ON', no = 'OFF' }: { on: boolean; yes?: string; no?: string }) {
  return (
    <span
      data-on={on}
      className={
        on
          ? 'rounded bg-foreground px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-background'
          : 'rounded border border-border px-2 py-0.5 font-mono text-[11px] tracking-[0.08em] text-muted-foreground'
      }
    >
      {on ? yes : no}
    </span>
  );
}
