'use client';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { istDate, istTime } from '@/lib/format';
import { useAero } from './aero-provider';

export function AlertsView() {
  const { home, copy, reload, pending, openSheet } = useAero();
  if (home.status === 'loading') return <LoadingState label={copy.loading} className="text-slate-800" />;
  if (home.status === 'error')
    return (
      <ErrorState
        title={copy.errorTitle}
        message={home.message}
        retryLabel={copy.retry}
        onRetry={reload}
        className="text-slate-900"
      />
    );
  const alerts = home.data.alerts;
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="text-2xl font-bold text-slate-900">{copy.alerts}</h1>
      {pending.length > 0 ? (
        <button
          type="button"
          onClick={openSheet}
          className="min-h-12 rounded-2xl bg-[#ff7a5c] px-4 text-left font-semibold text-slate-900"
        >
          {copy.pendingApprovals}: {pending[0]?.summary}
        </button>
      ) : null}
      {alerts.length === 0 && pending.length === 0 ? (
        <EmptyState className="text-slate-800">{copy.noAlerts}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <li key={alert.id} className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">{alert.title}</p>
              <p className="mt-1 text-sm text-slate-800">{alert.body}</p>
              <p className="mt-2 text-xs text-slate-700">
                {istDate(alert.at)} · {istTime(alert.at)} IST
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
