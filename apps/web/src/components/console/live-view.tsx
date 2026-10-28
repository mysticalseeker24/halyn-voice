'use client';

import { REASON_CODE_INFO, type WsMessage } from '@halyn/shared';
import { useCallback, useReducer } from 'react';
import { OutcomeBadge } from '@/components/outcome-badge';
import { EmptyState } from '@/components/states';
import { stageReducer, initialStageState } from '@/components/stage/stage-state';
import type { ApiClient } from '@/lib/api/client';
import { ACTION_LABELS, istTime } from '@/lib/format';
import { useHub } from '@/lib/hub/use-hub';

// Console Live: the Hub's stream for role 'console' — decisions (tier, signals, cues, the outcome word), handoffs,
// confirmations, call transcripts and test progress. The Stage's reducer keeps the latest decision and transcript;
// the feed keeps the newest 50 messages.

const KEEP = 50;

function feedReducer(feed: WsMessage[], message: WsMessage): WsMessage[] {
  if (message.type === 'ledger_append' || message.type === 'core_update') return feed;
  return [message, ...feed].slice(0, KEEP);
}

function line(m: WsMessage) {
  switch (m.type) {
    case 'decision': {
      const signals = m.decision.reasons.filter((r) =>
        ['signal', 'trigger'].includes(REASON_CODE_INFO[r].category),
      );
      return (
        <>
          <OutcomeBadge outcome={m.decision.outcome} />
          <span className="font-medium">{ACTION_LABELS[m.action]}</span>
          <span className="text-slate-600">
            tier {m.decision.tier ?? 'n/a'} (base {m.decision.base_tier ?? 'n/a'})
          </span>
          <span className="font-mono text-xs">{m.decision.reasons.join(' · ')}</span>
          <span className="text-slate-600">
            signals: {signals.length ? signals.join(', ') : 'none'}
            {m.cues?.length ? ` · cues: ${m.cues.join(', ')}` : ''}
          </span>
        </>
      );
    }
    case 'handoff':
      return (
        <>
          <span className="font-bold">HANDOFF {m.status.toUpperCase()}</span>
          <span className="font-mono text-xs">{m.reasons.join(' · ')}</span>
        </>
      );
    case 'confirm_request':
      return (
        <>
          <span className="font-bold">CONFIRMATION SENT</span>
          <span>{m.summary}</span>
          <span className="text-slate-600">via {m.channels.join(' + ')}</span>
        </>
      );
    case 'confirm_resolved':
      return (
        <>
          <span className="font-bold">CONFIRMATION {m.status.toUpperCase()}</span>
          {m.channel ? <span className="text-slate-600">via {m.channel}</span> : null}
        </>
      );
    case 'call_update':
      return (
        <>
          <span className="font-bold">CALL · {m.agent}</span>
          <span className="line-clamp-3 whitespace-pre-wrap">{m.text}</span>
        </>
      );
    case 'test_progress':
      return (
        <>
          <span className="font-bold">TEST {m.status.toUpperCase()}</span>
          <span>
            scenario {m.scenario_id} · {m.completed}/{m.total}
          </span>
        </>
      );
    default:
      return null;
  }
}

export function LiveFeed({ messages }: { messages: readonly WsMessage[] }) {
  if (messages.length === 0)
    return <EmptyState>Waiting for activity. Run a scenario or place a call.</EmptyState>;
  return (
    <ol aria-label="Live feed" className="flex flex-col gap-2">
      {messages.map((m, i) => (
        <li
          key={`${m.at}-${i}`}
          data-type={m.type}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
        >
          <span className="font-mono text-xs text-slate-500">{istTime(m.at)}</span>
          {line(m)}
        </li>
      ))}
    </ol>
  );
}

export function LiveView({ api, token }: { api: ApiClient; token: string | null }) {
  const [feed, push] = useReducer(feedReducer, []);
  const [stage, dispatch] = useReducer(stageReducer, initialStageState);
  const onMessage = useCallback((message: WsMessage) => {
    push(message);
    dispatch({ type: 'ws', message });
  }, []);
  const { status } = useHub({
    role: 'console',
    token,
    getTicket: (role) => api.wsTicket(role).then((r) => r.ticket),
    onMessage,
  });
  const d = stage.decision;
  return (
    <div className="flex flex-col gap-6">
      <p role="status" data-hub={status} className="text-sm">
        Hub: <span className="font-semibold">{status === 'open' ? 'LIVE' : status.toUpperCase()}</span>
      </p>
      {d ? (
        <section aria-label="Latest decision" className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-600 uppercase">Latest decision</h2>
          <div className="flex flex-wrap items-center gap-3">
            <OutcomeBadge outcome={d.decision.outcome} />
            <span className="font-medium">{ACTION_LABELS[d.action]}</span>
            <span className="font-mono text-xs">{d.decision.request_id}</span>
          </div>
        </section>
      ) : null}
      <LiveFeed messages={feed} />
    </div>
  );
}
