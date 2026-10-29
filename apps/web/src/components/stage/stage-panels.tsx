import { REASON_CODE_INFO } from '@halyn/shared';
import type { ReactNode } from 'react';
import { EventTimeline } from '@/components/event-timeline';
import { ChainStatusPill, LedgerLines } from '@/components/ledger-lines';
import { OutcomeBadge } from '@/components/outcome-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ACTION_LABELS, istTime, money } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { StageState } from './stage-state';

export function Panel({
  title,
  children,
  className,
  aside,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold tracking-[0.08em] text-muted-foreground uppercase">{title}</h2>
        {aside}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-4">{children}</div>
    </section>
  );
}

/** Aero's phone, as the customer sees it during the scenario. */
export function AeroPanel({ state }: { state: StageState }) {
  const prompt = state.confirmRequest && !state.confirmResolved ? state.confirmRequest : null;
  return (
    <Panel title="Aero app">
      <div className="aero mx-auto flex h-full w-[340px] flex-col gap-3 overflow-hidden rounded-3xl bg-background p-4 text-foreground ring-1 ring-border">
        <p className="text-base font-bold text-primary">Aero Bank</p>
        <div className="rounded-2xl bg-card p-3">
          <p className="text-sm font-semibold text-primary">Balance</p>
          {state.balance ? (
            <p data-testid="stage-balance" className="text-3xl font-bold">
              {money(state.balance)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Waiting for the first Aero update.</p>
          )}
        </div>
        {prompt ? (
          <div
            data-testid="aero-prompt"
            className="rounded-2xl border-2 border-coral bg-orange-50 dark:bg-orange-950/40 p-3"
          >
            <p className="text-sm font-bold">Approve this request?</p>
            <p className="mt-1 text-sm">{prompt.summary}</p>
            {prompt.amount ? <p className="text-xl font-bold">{money(prompt.amount)}</p> : null}
            <p className="mt-2 text-xs font-semibold">
              Aero will never ask you to move money to a safe account.
            </p>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-card p-3">
          <p className="text-sm font-semibold text-primary">Activity</p>
          {state.activity.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {state.activity.slice(-4).map((a) => (
                <li key={`${a.reference}-${a.at}`} className="text-sm">
                  {a.summary}
                  {a.amount ? <strong> {money(a.amount)}</strong> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

const SPEAKER: Record<string, string> = { caller: 'Caller', agent: 'Agent', system: 'System' };

export function TranscriptPanel({ state }: { state: StageState }) {
  return (
    <Panel title="Live call" className="min-h-0 flex-1">
      {state.transcript.length === 0 ? (
        <EmptyState>No call yet. Pick a scenario above.</EmptyState>
      ) : (
        <ol aria-label="Transcript" className="flex h-full flex-col justify-end gap-2">
          {state.transcript.slice(-7).map((line) => (
            <li
              key={line.id}
              className={cn(
                'max-w-[85%] rounded-xl px-4 py-2 text-lg',
                line.speaker === 'caller'
                  ? 'self-start bg-muted'
                  : line.speaker === 'agent'
                    ? 'self-end bg-muted text-foreground ring-1 ring-signal/50'
                    : 'self-center bg-card text-sm italic',
              )}
            >
              <span className="mr-2 text-xs font-semibold tracking-wide uppercase opacity-80">
                {line.agent} · {SPEAKER[line.speaker]}
              </span>
              {line.text}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function ConfirmPanel({ state }: { state: StageState }) {
  const { confirmRequest: req, confirmResolved: res } = state;
  return (
    <Panel title="Halyn Confirm" className="h-[250px]">
      {!req ? (
        <EmptyState>No confirmation requested.</EmptyState>
      ) : (
        <div className="space-y-2">
          <p className="text-lg font-semibold">{req.summary}</p>
          <p className="text-base">
            {ACTION_LABELS[req.action]}
            {req.amount ? ` · ${money(req.amount)}` : ''}
          </p>
          <p className="text-base">
            Sent to the customer via{' '}
            {req.channels.map((c) => (
              <span key={c} className="mr-2 rounded bg-muted px-2 py-0.5 font-mono text-sm">
                {c}
              </span>
            ))}
            · first answer wins
          </p>
          <p data-testid="confirm-status" className="text-xl font-bold">
            {res
              ? `${{ approved: 'APPROVED', declined: 'DECLINED', timeout: 'NO ANSWER (60 s)' }[res.status]}${res.channel ? ` via ${res.channel}` : ''}`
              : `Waiting for the customer… (expires ${istTime(req.expires_at)} IST)`}
          </p>
        </div>
      )}
    </Panel>
  );
}

export function DecisionPanel({ state }: { state: StageState }) {
  const d = state.decision;
  const final =
    d?.decision.final_outcome ??
    (d?.decision.outcome === 'step_up' && state.confirmResolved
      ? state.confirmResolved.status === 'approved'
        ? 'allow'
        : 'deny'
      : undefined);
  const reasons = d?.decision.reasons ?? [];
  const signals = reasons.filter((r) => ['signal', 'trigger'].includes(REASON_CODE_INFO[r].category));
  return (
    <Panel title="Halyn decision" className="h-[420px]">
      {!d ? (
        <EmptyState>Waiting for a request.</EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <OutcomeBadge outcome={d.decision.outcome} size="lg" />
            {final ? (
              <>
                <span aria-hidden="true" className="text-2xl">
                  →
                </span>
                <OutcomeBadge outcome={final} size="lg" />
              </>
            ) : null}
          </div>
          <p className="text-xl font-semibold">{ACTION_LABELS[d.action]}</p>
          <p className="font-mono text-sm opacity-80">
            {d.decision.request_id} · tier {d.decision.tier ?? 'n/a'} (base {d.decision.base_tier ?? 'n/a'})
          </p>
          <ul aria-label="Reasons" className="space-y-1">
            {reasons.map((r) => (
              <li key={r} className="text-base">
                <span className="mr-2 rounded bg-muted px-2 py-0.5 font-mono text-sm">{r}</span>
                {REASON_CODE_INFO[r].description}
              </li>
            ))}
          </ul>
          <p className="text-base">
            <span className="font-semibold">Signals: </span>
            {signals.length ? signals.join(', ') : 'none raised'}
          </p>
          {state.handoff ? (
            <p className="text-base font-semibold text-violet-600 dark:text-violet-300">
              Specialist handoff: {state.handoff.status}
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function LedgerPanel({
  state,
  loading,
  error,
  onRetry,
}: {
  state: StageState;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <Panel title="Ledger" className="min-h-0 flex-1" aside={<ChainStatusPill status={state.chain} />}>
      {loading ? (
        <LoadingState label="Loading the ledger…" />
      ) : error ? (
        <ErrorState
          title="Could not load the ledger"
          message={error}
          retryLabel="Try again"
          onRetry={onRetry}
        />
      ) : (
        <LedgerLines lines={state.ledger} max={6} />
      )}
    </Panel>
  );
}

export function TimelinePanel({ state }: { state: StageState }) {
  return (
    <Panel title="Event timeline" className="h-[190px]">
      <EventTimeline items={state.timeline} max={8} />
    </Panel>
  );
}
