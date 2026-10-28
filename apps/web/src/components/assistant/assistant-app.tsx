'use client';

import type { Decision, PassSummary, WsMessage } from '@halyn/shared';
import { useCallback, useEffect, useState } from 'react';
import { DemoCodePrompt } from '@/components/demo-code-prompt';
import { OutcomeBadge } from '@/components/outcome-badge';
import { ErrorState, LoadingState } from '@/components/states';
import { useHub } from '@/lib/hub/use-hub';
import { COPY } from '@/lib/i18n';
import { DEMO_CUSTOMER_ID, useDemoSession } from '@/lib/session';

// Saksham's Assistant (docs/UI.md): a task box, the Pass as a boarding-pass card, and the agent-to-agent call as it
// happens — Halyn's Pass-code line, every decision Aero's Gate makes, then the transcript when the call ends.

const DEFAULT_TASK = 'Get my card statement, then move my personal loan EMI to the 10th.';

const SCOPE_LABEL: Record<string, string> = {
  'statement.view': 'Statement',
  'balance.view': 'Balance',
  'card.freeze': 'Freeze card',
  'fee.waive': 'Fee waiver',
  'emi.move_date': 'Move EMI date',
};

type Line =
  | { kind: 'system'; text: string; at: string }
  | { kind: 'decision'; action: string; decision: Decision; at: string }
  | { kind: 'speech'; who: 'Assistant' | 'Aero'; text: string };

/** Bolna's transcript ("assistant: …" / "user: …") from the Assistant call's side: user = Aero. */
function transcriptLines(text: string): Line[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l): Line[] => {
      const m = /^(assistant|user|agent|bot)\s*:\s*(.+)$/i.exec(l);
      if (!m?.[2]) return [];
      const who = /^(assistant|agent|bot)$/i.test(m[1] ?? '') ? 'Assistant' : 'Aero';
      return [{ kind: 'speech', who, text: m[2] }];
    });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function PassCard({ pass }: { pass: PassSummary }) {
  const active = pass.status === 'active';
  return (
    <article
      data-testid="pass-card"
      aria-label="Halyn Pass"
      className="relative overflow-hidden rounded-3xl bg-slate-900 text-white shadow-lg"
    >
      <div className="flex items-center justify-between bg-indigo-600 px-5 py-3">
        <p className="font-mono text-sm font-bold tracking-widest">HALYN PASS</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? 'bg-white text-indigo-700' : 'bg-slate-300 text-slate-900'}`}
        >
          {pass.status.toUpperCase()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-300">Passenger</p>
          <p className="text-lg font-semibold">{pass.assistant_name}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-300">On behalf of</p>
          <p className="text-lg font-semibold">Saksham</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs uppercase tracking-wide text-slate-300">Allowed</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {pass.scopes.map((s) => (
              <li key={s.action} className="rounded-full bg-slate-700 px-3 py-1 text-sm">
                {SCOPE_LABEL[s.action] ?? s.action}
                {s.max_uses ? ` ×${s.max_uses}` : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-slate-600 px-5 py-3">
        <p className="font-mono text-xs text-slate-300">{pass.id}</p>
        <p className="text-sm">Valid until {new Date(pass.expires_at).toLocaleDateString()}</p>
      </div>
    </article>
  );
}

export function AssistantApp() {
  const { state, api, token, retry, submitCode } = useDemoSession({
    kind: 'customer',
    customerId: DEMO_CUSTOMER_ID,
  });
  const [passes, setPasses] = useState<PassSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [passId, setPassId] = useState<string | null>(null);
  const [task, setTask] = useState(DEFAULT_TASK);
  const [run, setRun] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [transcript, setTranscript] = useState<Line[]>([]);

  const load = useCallback(() => {
    api.listPasses().then(
      ({ passes: list }) => {
        setPasses(list);
        setPassId((current) => current ?? list.find((p) => p.status === 'active')?.id ?? null);
      },
      (e: unknown) => setLoadError(describe(e)),
    );
  }, [api]);

  useEffect(() => {
    if (state.status === 'ready') load();
  }, [state.status, load]);

  const onMessage = useCallback(
    (m: WsMessage) => {
      if (!run) return;
      if (m.type === 'decision')
        setLines((l) => [...l, { kind: 'decision', action: m.action, decision: m.decision, at: m.at }]);
      if (m.type === 'call_update' && m.run_id === run) {
        const spoken = transcriptLines(m.text);
        if (spoken.length > 0) setTranscript(spoken);
        else setLines((l) => [...l, { kind: 'system', text: m.text, at: m.at }]);
      }
    },
    [run],
  );
  const { status: hubStatus } = useHub({
    role: 'assistant',
    token,
    getTicket: (role) => api.wsTicket(role).then((r) => r.ticket),
    onMessage,
  });

  const start = async () => {
    if (!passId) return;
    setCalling(true);
    setError(null);
    setLines([]);
    setTranscript([]);
    try {
      const { execution_id } = await api.assistantTask(task.trim(), passId);
      setRun(execution_id);
    } catch (e) {
      setError(describe(e));
    } finally {
      setCalling(false);
    }
  };

  if (state.status === 'needs_code')
    return (
      <div className="p-6">
        <DemoCodePrompt
          copy={{
            label: COPY.en.demoCodeLabel,
            hint: COPY.en.demoCodeHint,
            cta: COPY.en.demoCodeCta,
            bad: COPY.en.demoCodeBad,
          }}
          rejected={state.rejected}
          onSubmit={submitCode}
          tone="aero"
        />
      </div>
    );
  if (state.status === 'error')
    return (
      <ErrorState title="Could not sign in" message={state.message} retryLabel="Try again" onRetry={retry} />
    );
  if (loadError)
    return (
      <ErrorState
        title="Could not load your Passes"
        message={loadError}
        retryLabel="Try again"
        onRetry={() => {
          setLoadError(null);
          load();
        }}
      />
    );
  if (state.status === 'loading' || !passes) return <LoadingState label="Loading…" />;

  const active = passes.filter((p) => p.status === 'active');
  const pass = passes.find((p) => p.id === passId) ?? null;
  const last = [...lines].reverse().find((l) => l.kind === 'decision');

  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Saksham&apos;s Assistant</h1>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Live: {hubStatus === 'open' ? 'connected' : hubStatus}
        </p>
      </header>

      {active.length === 0 ? (
        <p className="rounded-2xl border p-4">
          No active Pass. Ask Saksham to authorise this assistant in the Aero app (Assistant tab).
        </p>
      ) : (
        <section aria-label="Your Pass" className="flex flex-col gap-3">
          {active.length > 1 ? (
            <label className="flex items-center gap-2 text-sm">
              Pass
              <select
                value={passId ?? ''}
                onChange={(e) => setPassId(e.target.value)}
                className="min-h-11 rounded-xl border px-3"
              >
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {pass ? <PassCard pass={pass} /> : null}
        </section>
      )}

      <section aria-label="Task" className="flex flex-col gap-3">
        <label htmlFor="task" className="font-medium">
          What should I do?
        </label>
        <textarea
          id="task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          maxLength={300}
          rows={3}
          className="rounded-2xl border p-3 text-base"
        />
        <button
          type="button"
          onClick={() => void start()}
          disabled={!pass || calling || task.trim().length < 3}
          className="min-h-12 rounded-2xl bg-indigo-600 px-5 font-semibold text-white disabled:opacity-60"
        >
          {calling ? 'Calling…' : 'Call Aero for me'}
        </button>
        {error ? (
          <p role="alert" className="rounded-xl bg-red-100 p-3 text-red-900">
            {error}
          </p>
        ) : null}
      </section>

      {run ? (
        <section aria-label="Call" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Call with Aero</h2>
          <p className="text-muted-foreground font-mono text-xs">{run}</p>
          {lines.length === 0 && transcript.length === 0 ? (
            <p className="text-muted-foreground">Calling Aero from my number… the conversation shows here.</p>
          ) : null}
          <ol className="flex flex-col gap-2" aria-live="polite">
            {lines.map((l, i) =>
              l.kind === 'decision' ? (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
                  <OutcomeBadge outcome={l.decision.outcome} />
                  <span className="font-mono text-sm">{l.action}</span>
                  <span className="text-muted-foreground text-sm">{l.decision.reasons.join(', ')}</span>
                </li>
              ) : l.kind === 'system' ? (
                <li key={i} className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-950">
                  {l.text}
                </li>
              ) : null,
            )}
          </ol>
          {transcript.length > 0 ? (
            <ol className="flex flex-col gap-2" aria-label="Transcript">
              {transcript.map((l, i) =>
                l.kind === 'speech' ? (
                  <li
                    key={i}
                    className={`max-w-[85%] rounded-2xl p-3 ${l.who === 'Assistant' ? 'self-end bg-indigo-600 text-white' : 'self-start bg-slate-100 text-slate-900'}`}
                  >
                    <span className="block text-xs font-semibold opacity-80">{l.who}</span>
                    {l.text}
                  </li>
                ) : null,
              )}
            </ol>
          ) : null}
          {last && last.kind === 'decision' ? (
            <p className="font-medium">
              Last outcome: <OutcomeBadge outcome={last.decision.outcome} />
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
