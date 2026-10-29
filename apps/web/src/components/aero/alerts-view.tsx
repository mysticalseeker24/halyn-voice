'use client';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { istDate, istTime } from '@/lib/format';
import { useAero } from './aero-provider';

export function AlertsView() {
  const { home, copy, reload, pending, openSheet } = useAero();
  if (home.status === 'loading') return <LoadingState label={copy.loading} className="text-foreground" />;
  if (home.status === 'error')
    return (
      <ErrorState
        title={copy.errorTitle}
        message={home.message}
        retryLabel={copy.retry}
        onRetry={reload}
        className="text-foreground"
      />
    );
  const alerts = home.data.alerts;
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="text-2xl font-bold text-foreground">{copy.alerts}</h1>
      {pending.length > 0 ? (
        <button
          type="button"
          onClick={openSheet}
          className="min-h-12 rounded-2xl bg-coral px-4 text-left font-semibold text-foreground"
        >
          {copy.pendingApprovals}: {pending[0]?.summary}
        </button>
      ) : null}
      {alerts.length === 0 && pending.length === 0 ? (
        <EmptyState className="text-foreground">{copy.noAlerts}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <li key={alert.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="font-semibold text-foreground">{alert.title}</p>
              <p className="mt-1 text-sm text-foreground">{alert.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {istDate(alert.at)} · {istTime(alert.at)} IST
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
