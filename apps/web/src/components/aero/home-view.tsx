'use client';

import type { Copy } from '@/lib/i18n';
import type { AeroHome } from '@halyn/shared';
import { istDate, maskLast4, money } from '@/lib/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useAero } from './aero-provider';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-3xl border border-sky-100 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-sky-800">{title}</h2>
      {children}
    </section>
  );
}

export function HomeContent({
  data,
  copy,
  onReview,
  pendingCount,
  notice,
  onDismiss,
}: {
  data: AeroHome;
  copy: Copy;
  onReview: () => void;
  pendingCount: number;
  notice: string | null;
  onDismiss: () => void;
}) {
  const primary = data.accounts[0];
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">
        {copy.greeting}, {data.customer.name}
      </h1>

      {notice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-2xl bg-sky-100 p-3 text-sm font-medium text-slate-900"
        >
          <span>{notice}</span>
          <button type="button" onClick={onDismiss} aria-label={copy.close} className="size-11 text-xl">
            ×
          </button>
        </div>
      ) : null}

      {pendingCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#ff7a5c] p-4 text-slate-900">
          <span className="font-semibold">{copy.pendingApprovals}</span>
          <button
            type="button"
            onClick={onReview}
            className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-slate-900"
          >
            {copy.review}
          </button>
        </div>
      ) : null}

      <Card title={copy.balance}>
        {primary ? (
          <>
            <p data-testid="balance" className="mt-1 text-4xl font-bold text-slate-900">
              {money(primary.balance)}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              {primary.type} · {maskLast4(primary.last4)}
            </p>
          </>
        ) : (
          <EmptyState>—</EmptyState>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title={copy.card}>
          {data.card ? (
            <>
              <p className="mt-1 font-mono text-base">{maskLast4(data.card.last4)}</p>
              <p
                data-testid="card-status"
                className={
                  data.card.status === 'frozen'
                    ? 'mt-2 inline-block rounded-full bg-sky-800 px-3 py-1 text-sm font-semibold text-white'
                    : 'mt-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-900'
                }
              >
                {data.card.status === 'frozen' ? copy.cardFrozen : copy.cardActive}
              </p>
            </>
          ) : (
            <EmptyState>—</EmptyState>
          )}
        </Card>
        <Card title={copy.loan}>
          {data.loan ? (
            <>
              <p className="mt-1 text-base font-semibold">
                {copy.emi} {money(data.loan.emi)}
              </p>
              <p className="text-sm text-slate-700">
                {copy.emiDay} {data.loan.emi_day}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {copy.outstanding}: {data.loan.outstanding ? money(data.loan.outstanding) : '—'}
              </p>
            </>
          ) : (
            <EmptyState>—</EmptyState>
          )}
        </Card>
      </div>

      <Card title={copy.activity}>
        {data.activity.length === 0 ? (
          <EmptyState>{copy.noActivity}</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.activity.slice(0, 6).map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{tx.description}</p>
                  <p className="text-xs text-slate-700">{istDate(tx.created_at)}</p>
                </div>
                <p
                  className={
                    tx.kind === 'credit'
                      ? 'text-sm font-semibold text-emerald-800'
                      : 'text-sm font-semibold text-slate-900'
                  }
                >
                  {tx.kind === 'credit' ? '+' : '−'}
                  {money(tx.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function HomeView() {
  const { home, copy, reload, pending, openSheet, notice, dismissNotice } = useAero();
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
  return (
    <HomeContent
      data={home.data}
      copy={copy}
      onReview={openSheet}
      pendingCount={pending.length}
      notice={notice ? copy[notice] : null}
      onDismiss={dismissNotice}
    />
  );
}
