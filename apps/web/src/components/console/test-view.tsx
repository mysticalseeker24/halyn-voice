'use client';

import type {
  PermissionMapResponse,
  Region,
  Scorecard,
  TestRunResponse,
  VoiceRunResult,
  WsMessage,
} from '@halyn/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/states';
import { ApiError, type ApiClient } from '@/lib/api/client';
import { istTime } from '@/lib/format';
import { useHub } from '@/lib/hub/use-hub';
import { cn } from '@/lib/utils';
import { cell, Loaded, Table } from './loaded';

// Halyn Test (docs/UI.md, Step 15): run the acceptance scenarios against the live Hub (text mode: one
// /web/stage/run per scenario, each its own request), the scorecard and what changed since the previous run, the
// permission map of both Aero graphs, and the voice-mode personas (real calls: Saksham's go-ahead each time).

const POLL_MS = 1500;
const SCENARIO_TIMEOUT_MS = 45_000;

const STATUS_STYLE = {
  passed: 'bg-emerald-700 text-white',
  failed: 'bg-red-700 text-white',
  skipped: 'bg-slate-600 text-white',
  pending: 'bg-amber-400 text-slate-900',
} as const;

function StatusWord({ status }: { status: keyof typeof STATUS_STYLE }) {
  return (
    <span data-status={status} className={cn('rounded px-2 py-0.5 text-xs font-bold', STATUS_STYLE[status])}>
      {status.toUpperCase()}
    </span>
  );
}

function Tile({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {value}
        {ok === undefined ? null : (
          <span className={cn('ml-2 text-sm font-bold', ok ? 'text-emerald-700' : 'text-red-700')}>
            {ok ? 'PASS' : 'FAIL'}
          </span>
        )}
      </p>
    </div>
  );
}

export function ScorecardTiles({ card }: { card: Scorecard }) {
  return (
    <div aria-label="Scorecard" role="group" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Actions without a grant" value={String(card.ungranted_writes)} ok={card.ungranted_writes === 0} />
      <Tile label="Attacks stopped" value={`${card.attacks_stopped} / ${card.attacks_total}`} />
      <Tile label="Tasks completed" value={`${card.tasks_completed} / ${card.tasks_total}`} />
      <Tile
        label="Median propose_action"
        value={card.median_propose_ms === null ? '—' : `${Math.round(card.median_propose_ms)} ms`}
      />
    </div>
  );
}

/** The scorecard, per-scenario results and the changes since the previous run. */
export function TestRunReport({ data }: { data: TestRunResponse }) {
  const { run, scorecard, previous } = data;
  const byId = new Map(run.results.map((r) => [r.scenario_id, r]));
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-slate-600">
        Run <span className="font-mono">{run.id}</span> · {run.region ? `${run.region} pack` : 'all scenarios'} ·
        started {istTime(run.started_at)} IST · {scorecard.passed} passed, {scorecard.failed} failed,{' '}
        {scorecard.skipped} skipped, {scorecard.pending} pending
      </p>
      <ScorecardTiles card={scorecard} />
      <Table label="Scenario results" head={['Scenario', 'Result', 'propose_action ms', 'Notes']}>
        {run.scenarios.map((id) => {
          const r = byId.get(id);
          return (
            <tr key={id} data-testid="scenario-row">
              <td className={cell}>
                <span className="font-semibold">{id}</span> {r?.title ?? ''}
              </td>
              <td className={cell}>
                <StatusWord status={r?.status ?? 'pending'} />
              </td>
              <td className={cell}>{r?.propose_ms.length ? r.propose_ms.join(', ') : '—'}</td>
              <td className={cell}>{r ? [...r.failures, ...r.skipped].slice(0, 3).join(' · ') : ''}</td>
            </tr>
          );
        })}
      </Table>
      <section aria-label="Changes since the previous run" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Changes since the previous run</h2>
        {!previous ? (
          <p className="text-sm text-slate-600">No previous run to compare with.</p>
        ) : previous.changes.length === 0 ? (
          <p className="text-sm text-slate-600">No changes since run {previous.id}.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {previous.changes.map((c) => (
              <li key={c.scenario_id} data-testid="change">
                Scenario {c.scenario_id}: <StatusWord status={c.from} /> → <StatusWord status={c.to} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function PermissionMapPanel({ map }: { map: PermissionMapResponse }) {
  return (
    <div className="flex flex-col gap-4">
      {map.graphs.map((g) => (
        <article key={g.file} data-testid="graph" className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              data-status={g.status}
              className={cn(
                'rounded px-2 py-0.5 text-sm font-bold',
                g.status === 'GREEN' ? 'bg-emerald-700 text-white' : 'bg-red-700 text-white',
              )}
            >
              {g.status}
            </span>
            <p className="font-medium">{g.agent}</p>
            <span className="font-mono text-xs">{g.file}</span>
          </div>
          <p className="mt-2 text-sm">
            Paths to <span className="font-mono">propose_action</span> ({g.propose_node ?? 'missing'}):{' '}
            {g.paths.length ? g.paths.map((p) => p.join(' → ')).join(' | ') : 'none'}
          </p>
          <ul className="mt-2 text-sm">
            {g.guarded.map((n) => (
              <li key={n.node}>
                <span className="font-mono">{n.node}</span> ←{' '}
                {n.inbound.map((e) => `${e.from} (${e.kind === 'event' ? `event ${e.event}` : 'LLM'})`).join(', ')}
              </li>
            ))}
          </ul>
          {g.violations.length ? (
            <ul role="alert" className="mt-2 text-sm text-red-700">
              {g.violations.map((v) => (
                <li key={`${v.from}-${v.to}`}>
                  LLM edge into {v.to}: {v.path.join(' → ')}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function VoicePanel({ api }: { api: ApiClient }) {
  const [runs, setRuns] = useState<Record<string, VoiceRunResult | { execution_id: string } | string>>({});
  return (
    <Loaded what="voice personas" load={api.voicePersonas}>
      {(d) => (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            Real calls from number B to Aero&apos;s number A — each one only with Saksham&apos;s go-ahead, 09:00–21:00
            IST. A persona&apos;s button stays off until its Bolna agent exists. Attacker personas are not created.
          </p>
          <Table label="Voice personas" head={['Persona', 'Action', 'Run', 'Result']}>
            {d.personas.map((p) => {
              const run = runs[p.id];
              const can = p.ready && d.calling_window && d.bolna;
              return (
                <tr key={p.id} data-testid="persona-row">
                  <td className={cell}>{p.label}</td>
                  <td className={cell}>
                    <span className="font-mono text-xs">{p.action}</span>
                  </td>
                  <td className={cell}>
                    <button
                      type="button"
                      disabled={!can}
                      onClick={() =>
                        api.startVoiceRun(p.id).then(
                          (r) => setRuns((s) => ({ ...s, [p.id]: r })),
                          (err: unknown) =>
                            setRuns((s) => ({ ...s, [p.id]: err instanceof Error ? err.message : 'failed' })),
                        )
                      }
                      className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Place call
                    </button>
                    {!p.ready ? <p className="text-xs text-slate-600">Agent not created yet</p> : null}
                  </td>
                  <td className={cell}>
                    {typeof run === 'string' ? (
                      <span className="text-red-700">{run}</span>
                    ) : run && 'status' in run ? (
                      <>
                        <StatusWord status={run.status === 'running' ? 'pending' : run.status} /> {run.notes.join(' · ')}
                      </>
                    ) : run ? (
                      <button
                        type="button"
                        onClick={() =>
                          api.voiceRun(p.id, run.execution_id).then(
                            (r) => setRuns((s) => ({ ...s, [p.id]: r })),
                            () => undefined,
                          )
                        }
                        className="min-h-11 rounded-md border border-indigo-600 px-4 text-sm text-indigo-700"
                      >
                        Score the call
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
    </Loaded>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TestView({ api, token }: { api: ApiClient; token: string | null }) {
  const [region, setRegion] = useState<Region | null>(null);
  const [data, setData] = useState<TestRunResponse | null | undefined>(undefined);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wake = useRef<() => void>(() => undefined);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('region');
    if (r === 'IN' || r === 'US') setRegion(r);
    api.testRun('latest').then(setData, (err: unknown) =>
      err instanceof ApiError && err.code === 'E_NOT_FOUND' ? setData(null) : setError(String(err)),
    );
  }, [api]);

  // test_progress from the Hub wakes the waiting loop early (it polls as well, in case the socket is down).
  const onMessage = useCallback((m: WsMessage) => {
    if (m.type === 'test_progress' && m.status !== 'running') wake.current();
  }, []);
  useHub({ role: 'console', token, getTicket: (role) => api.wsTicket(role).then((r) => r.ticket), onMessage });

  const waitFor = async (runId: string, scenario: string): Promise<TestRunResponse | null> => {
    const until = Date.now() + SCENARIO_TIMEOUT_MS;
    while (Date.now() < until) {
      await Promise.race([sleep(POLL_MS), new Promise<void>((r) => (wake.current = r))]);
      const next = await api.testRun(runId).catch(() => null);
      if (next) setData(next);
      if (next?.run.results.some((r) => r.scenario_id === scenario)) return next;
    }
    return null;
  };

  const runSuite = async () => {
    setError(null);
    try {
      const created = await api.createTestRun(region);
      setData(created);
      for (const scenario of created.run.scenarios) {
        setRunning(scenario);
        await api.runScenarioInSuite(scenario, created.run.id);
        if (!(await waitFor(created.run.id, scenario))) setError(`Scenario ${scenario} did not report back in time.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The run failed.');
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Run" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Pack" className="flex rounded-md border border-slate-300 p-1">
            {([null, 'IN', 'US'] as const).map((r) => (
              <button
                key={r ?? 'all'}
                type="button"
                aria-pressed={region === r}
                disabled={running !== null}
                onClick={() => setRegion(r)}
                className={cn(
                  'min-h-11 rounded px-4 text-sm font-medium',
                  region === r ? 'bg-indigo-600 text-white' : 'text-slate-700',
                )}
              >
                {r ?? 'All scenarios'}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={running !== null}
            onClick={() => void runSuite()}
            className="min-h-11 rounded-md bg-indigo-600 px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {region ? `Test the ${region} pack` : 'Run all scenarios'}
          </button>
          <p className="text-sm text-slate-600">Text mode, against the live Hub (demo customer).</p>
          {running ? (
            <p role="status" className="text-sm font-semibold">
              Running scenario {running}…
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {data === undefined ? (
          <LoadingState label="Loading the latest run…" />
        ) : data === null ? (
          <EmptyState>No test run yet. Run the scenarios to get a scorecard.</EmptyState>
        ) : (
          <TestRunReport data={data} />
        )}
      </section>
      <section aria-label="Permission map" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Permission map</h2>
        <Loaded what="the permission map" load={api.permissionMap}>
          {(map) => <PermissionMapPanel map={map} />}
        </Loaded>
      </section>
      <section aria-label="Voice mode" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Voice mode</h2>
        <VoicePanel api={api} />
      </section>
    </div>
  );
}
