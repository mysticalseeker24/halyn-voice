'use client';

import {
  type ActionId,
  type CompiledAction,
  type ConsoleRequest,
  OUTCOMES,
  type Outcome,
  REASON_CODE_INFO,
} from '@halyn/shared';
import Link from 'next/link';
import { useState } from 'react';
import { OutcomeBadge } from '@/components/outcome-badge';
import type { ApiClient } from '@/lib/api/client';
import { ACTION_LABELS, istDate, istTime } from '@/lib/format';
import { cell, Flag, Loaded, Table } from './loaded';

// Halyn Console pages (docs/UI.md, Step 13). Plain and consistent for now; the UI refinement pass comes later.

const when = (iso: string) => `${istDate(iso)} ${istTime(iso)} IST`;
const actionLabel = (action: string) => ACTION_LABELS[action as ActionId] ?? action;
const isOutcome = (value: string): value is Outcome => (OUTCOMES as readonly string[]).includes(value);

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

function Codes({ codes }: { codes: readonly string[] }) {
  if (codes.length === 0) return <span className="text-slate-500">none</span>;
  return <span className="font-mono text-xs">{codes.join(' · ')}</span>;
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  ) : null;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

// ── Calls ────────────────────────────────────────────────────────────────────────────────────────

export function CallsView({ api }: { api: ApiClient }) {
  return (
    <Loaded
      what="calls"
      load={api.calls}
      isEmpty={(d) => d.calls.length === 0}
      empty="No calls yet. Calls appear here as Bolna reports them."
    >
      {({ calls }) => (
        <Table label="Calls" head={['Started', 'Channel', 'Caller', 'Requests', 'Last outcome', '']}>
          {calls.map((call) => (
            <tr key={call.run_id} data-testid="call-row">
              <td className={cell}>{when(call.started_at)}</td>
              <td className={cell}>
                {call.channel} · {call.region}
                {call.ended_at ? '' : ' · live'}
              </td>
              <td className={cell}>
                {call.kind === 'ai_assistant' ? 'AI assistant' : call.kind === 'human' ? 'Person' : 'Unknown'}
                {' · '}
                {call.registered ? 'registered number' : 'unregistered'}
                {call.from_last4 ? ` (…${call.from_last4})` : ''}
              </td>
              <td className={cell}>{call.requests}</td>
              <td className={cell}>
                {call.last_outcome ? <OutcomeBadge outcome={call.last_outcome} /> : '—'}
              </td>
              <td className={cell}>
                <Link
                  href={`/console/calls/${encodeURIComponent(call.run_id)}`}
                  className="text-indigo-700 underline"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Loaded>
  );
}

export function RequestsTable({ requests }: { requests: readonly ConsoleRequest[] }) {
  return (
    <Table label="Requests" head={['Time', 'Action', 'Decision', 'Tier', 'Reasons', 'Signals · cues', 'Status']}>
      {requests.map((r) => (
        <tr key={r.request_id} data-testid="request-row">
          <td className={cell}>{istTime(r.created_at)}</td>
          <td className={cell}>
            <p className="font-medium">{actionLabel(r.action)}</p>
            <p className="text-slate-600">{r.summary}</p>
            <Mono>{r.request_id}</Mono>
          </td>
          <td className={cell}>
            <span className="flex flex-wrap items-center gap-1">
              <OutcomeBadge outcome={r.outcome} />
              {r.final_outcome && r.final_outcome !== r.outcome && isOutcome(r.final_outcome) ? (
                <>
                  <span aria-hidden="true">→</span>
                  <OutcomeBadge outcome={r.final_outcome} />
                </>
              ) : null}
            </span>
          </td>
          <td className={cell}>
            {r.tier ?? 'n/a'} (base {r.base_tier ?? 'n/a'})
          </td>
          <td className={cell}>
            <Codes codes={r.reasons} />
          </td>
          <td className={cell}>
            <Codes codes={[...r.signals, ...r.cues]} />
            {r.coaching_score > 0 ? (
              <p className="text-xs text-slate-600">coaching {r.coaching_score.toFixed(2)}</p>
            ) : null}
          </td>
          <td className={cell}>{r.status}</td>
        </tr>
      ))}
    </Table>
  );
}

export function CallDetailView({ api, runId }: { api: ApiClient; runId: string }) {
  return (
    <Loaded what="the call" load={() => api.call(runId)}>
      {({ call, requests, handoffs, transcript, transcript_status, recording_url }) => (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <dt className="text-slate-500">Run</dt>
            <dd>
              <Mono>{call.run_id}</Mono>
            </dd>
            <dt className="text-slate-500">Channel</dt>
            <dd>
              {call.channel} · {call.region}
            </dd>
            <dt className="text-slate-500">Caller</dt>
            <dd>
              {call.kind} · {call.registered ? 'registered number' : 'unregistered'}
              {call.from_last4 ? ` (…${call.from_last4})` : ''}
              {call.pass_id ? ` · Pass ${call.pass_id}` : ''}
            </dd>
            <dt className="text-slate-500">Started</dt>
            <dd>{when(call.started_at)}</dd>
            <dt className="text-slate-500">Ended</dt>
            <dd>{call.ended_at ? when(call.ended_at) : 'still live'}</dd>
            <dt className="text-slate-500">Recording</dt>
            <dd>
              {recording_url ? (
                <a href={recording_url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                  Listen to the recording
                </a>
              ) : (
                'No recording yet'
              )}
            </dd>
          </dl>
          <section aria-label="Requests" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Requests</h2>
            {requests.length ? (
              <RequestsTable requests={requests} />
            ) : (
              <p className="text-sm text-slate-600">No requests on this call.</p>
            )}
          </section>
          <section aria-label="Handoffs" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Handoffs</h2>
            {handoffs.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {handoffs.map((h) => (
                  <li key={h.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <span className="mr-2 font-bold">{h.status.toUpperCase()}</span>
                    {h.summary} · <Codes codes={h.reasons} /> ·{' '}
                    <Link href="/console/handoffs" className="text-indigo-700 underline">
                      Handoffs
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">No handoff on this call.</p>
            )}
          </section>
          <section aria-label="Transcript" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Transcript</h2>
            {transcript ? (
              <pre className="max-h-[480px] overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-sm whitespace-pre-wrap">
                {transcript}
              </pre>
            ) : (
              <p className="text-sm text-slate-600">
                {transcript_status === 'none'
                  ? 'Bolna has no transcript for this call yet.'
                  : 'Transcript unavailable (text-mode run, or Bolna not reachable).'}
              </p>
            )}
          </section>
        </div>
      )}
    </Loaded>
  );
}

// ── Policies ─────────────────────────────────────────────────────────────────────────────────────

function actionRule(a: CompiledAction): string {
  if (a.perimeter === 'human_only') return 'human only';
  const parts = [`tier ${a.tier}`];
  if (a.protective) parts.push('protective');
  if (a.read) parts.push('read');
  if (a.limit) parts.push(`limit ${a.limit.amount_minor ?? '—'} minor / ${a.limit.count ?? '—'} per ${a.limit.per}`);
  if (a.human_only_above_minor) parts.push(`human above ${a.human_only_above_minor} minor`);
  if (a.hold_hours) parts.push(`hold ${a.hold_hours} h`);
  return parts.join(' · ');
}

export function PoliciesView({ api }: { api: ApiClient }) {
  return (
    <Loaded what="policies" load={api.policies} isEmpty={(d) => d.packs.length === 0} empty="No packs in KV.">
      {({ packs, missing }) => (
        <div className="flex flex-col gap-8">
          {missing.length ? (
            <p role="alert" className="text-sm text-red-700">
              Missing pack: {missing.join(', ')} — calls in that region are denied (fail closed).
            </p>
          ) : null}
          {packs.map((pack) => (
            <section key={pack.region} aria-label={`Pack ${pack.region}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">
                  {pack.region} · {pack.pack} v{pack.version} · {pack.currency}
                </h2>
                <Mono>{pack.source_sha.slice(0, 12)}</Mono>
                <Link
                  href={`/console/test?region=${pack.region}`}
                  className="ml-auto min-h-11 rounded-md border border-indigo-600 px-4 py-2.5 text-sm font-medium text-indigo-700"
                >
                  Test this pack
                </Link>
              </div>
              <p className="text-sm text-slate-600">
                Coaching hold at {pack.coaching.threshold} · confirmation{' '}
                {pack.confirm.timeout_seconds} s
              </p>
              <Table label={`Actions ${pack.region}`} head={['Action', 'Rule', 'Critical', 'In a Pass', 'Moves money']}>
                {Object.entries(pack.actions).map(([id, a]) => (
                  <tr key={id}>
                    <td className={cell}>
                      {actionLabel(id)} <Mono>{id}</Mono>
                    </td>
                    <td className={cell}>{actionRule(a)}</td>
                    <td className={cell}>
                      <Flag on={a.critical} yes="CRITICAL" no="no" />
                    </td>
                    <td className={cell}>{a.pass_eligible ? 'eligible' : 'never'}</td>
                    <td className={cell}>{a.moves_money ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </Table>
            </section>
          ))}
        </div>
      )}
    </Loaded>
  );
}

// ── Passes ───────────────────────────────────────────────────────────────────────────────────────

export function PassesView({ api }: { api: ApiClient }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Loaded
      what="Passes"
      load={api.consolePasses}
      isEmpty={(d) => d.passes.length === 0}
      empty="No Passes issued yet."
    >
      {({ passes }, reload) => (
        <div className="flex flex-col gap-3">
          <ErrorLine message={error} />
          <Table label="Passes" head={['Pass', 'Customer', 'Assistant', 'Scopes', 'Status', 'Expires', '']}>
            {passes.map((p) => (
              <tr key={p.id} data-testid="pass-row">
                <td className={cell}>
                  <Mono>{p.id}</Mono>
                </td>
                <td className={cell}>
                  <Mono>{p.customer_id}</Mono>
                </td>
                <td className={cell}>{p.assistant_name}</td>
                <td className={cell}>{p.scopes.map((s) => actionLabel(s.action)).join(', ')}</td>
                <td className={cell}>
                  <span className="font-bold">{p.status.toUpperCase()}</span>
                </td>
                <td className={cell}>{when(p.expires_at)}</td>
                <td className={cell}>
                  {p.status === 'active' ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setBusy(p.id);
                        setError(null);
                        api
                          .consoleRevokePass(p.id)
                          .then(reload, (err: unknown) => setError(errorText(err, 'Could not revoke.')))
                          .finally(() => setBusy(null));
                      }}
                      className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Loaded>
  );
}

// ── Signals ──────────────────────────────────────────────────────────────────────────────────────

function CountList({ label, rows }: { label: string; rows: { key: string; count: number; note?: string }[] }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{label}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">None raised.</p>
      ) : (
        <Table label={label} head={['Code', 'Count', 'Meaning']}>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={cell}>
                <Mono>{r.key}</Mono>
              </td>
              <td className={cell}>{r.count}</td>
              <td className={cell}>{r.note ?? ''}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

export function SignalsView({ api }: { api: ApiClient }) {
  return (
    <Loaded
      what="signals"
      load={api.signals}
      isEmpty={(d) => d.window.requests === 0}
      empty="No requests yet. Signal counts appear after the first call."
    >
      {(d) => (
        <div className="flex flex-col gap-8">
          <p className="text-sm text-slate-600">
            Over the newest {d.window.requests} requests{d.window.since ? ` since ${when(d.window.since)}` : ''}.
            Codes and cue ids only — never what the caller said.
          </p>
          <CountList label="Signals" rows={d.signals.map((s) => ({ key: s.code, count: s.count }))} />
          <CountList
            label="Reason codes"
            rows={d.reasons.map((r) => ({
              key: r.code,
              count: r.count,
              note: REASON_CODE_INFO[r.code].description,
            }))}
          />
          <CountList label="Coaching cues" rows={d.cues.map((c) => ({ key: c.cue, count: c.count }))} />
          <section aria-label="Latest flagged requests" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Latest flagged requests</h2>
            {d.latest.length === 0 ? (
              <p className="text-sm text-slate-600">No request raised a signal or cue.</p>
            ) : (
              <Table label="Latest flagged" head={['Time', 'Request', 'Action', 'Decision', 'Signals · cues']}>
                {d.latest.map((r) => (
                  <tr key={r.request_id}>
                    <td className={cell}>{when(r.created_at)}</td>
                    <td className={cell}>
                      <Link
                        href={`/console/calls/${encodeURIComponent(r.run_id)}`}
                        className="text-indigo-700 underline"
                      >
                        <Mono>{r.request_id}</Mono>
                      </Link>
                    </td>
                    <td className={cell}>{actionLabel(r.action)}</td>
                    <td className={cell}>
                      <OutcomeBadge outcome={r.outcome} />
                    </td>
                    <td className={cell}>
                      <Codes codes={[...r.signals, ...r.cues]} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </div>
      )}
    </Loaded>
  );
}

// ── Ledger ───────────────────────────────────────────────────────────────────────────────────────

type Verify = Awaited<ReturnType<ApiClient['ledgerVerify']>>;

export function LedgerView({ api }: { api: ApiClient }) {
  const [verify, setVerify] = useState<Verify | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runVerify = () => {
    setBusy(true);
    setError(null);
    api
      .ledgerVerify()
      .then(setVerify, (err: unknown) => setError(errorText(err, 'Could not verify the chain.')))
      .finally(() => setBusy(false));
  };

  const exportChain = () => {
    setError(null);
    api.ledgerExport().then(
      (chain) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(chain, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `halyn-ledger-${chain.tenant_id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      },
      (err: unknown) => setError(errorText(err, 'Could not export the ledger.')),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runVerify}
          disabled={busy}
          className="min-h-11 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          Verify chain
        </button>
        <button
          type="button"
          onClick={exportChain}
          className="min-h-11 rounded-md border border-indigo-600 px-4 text-sm font-medium text-indigo-700"
        >
          Export JSON
        </button>
        {verify ? (
          <p role="status" data-chain={verify.ok ? 'verified' : 'broken'} className="text-sm font-semibold">
            {verify.ok
              ? `✓ Chain verified · ${verify.entries} entries`
              : `✕ Chain BROKEN at #${verify.first_bad_seq}`}
          </p>
        ) : null}
      </div>
      <ErrorLine message={error} />
      <Loaded
        what="the ledger"
        load={() => api.ledger(100)}
        isEmpty={(d) => d.entries.length === 0}
        empty="No ledger entries yet."
      >
        {({ entries }) => (
          <Table label="Ledger" head={['#', 'Type', 'Ref', 'Hash', 'Time']}>
            {[...entries].reverse().map((e) => (
              <tr key={e.seq} data-seq={e.seq}>
                <td className={cell}>{e.seq}</td>
                <td className={cell}>{e.type}</td>
                <td className={cell}>
                  <Mono>{e.ref_id}</Mono>
                </td>
                <td className={cell} title={e.hash}>
                  <Mono>
                    {e.prev_hash.slice(0, 8)}… → {e.hash.slice(0, 8)}…
                  </Mono>
                </td>
                <td className={cell}>{when(e.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Loaded>
    </div>
  );
}

// ── Integrations ─────────────────────────────────────────────────────────────────────────────────

const AGENT_LABEL = {
  aero_in: 'Aero (India, Hindi)',
  aero_en: 'Aero (US, English, web)',
  confirm: 'Halyn Confirm',
  assistant: "Saksham's Assistant",
} as const;

export function IntegrationsView({ api }: { api: ApiClient }) {
  return (
    <Loaded what="integrations" load={api.integrations}>
      {(d) => (
        <div className="flex flex-col gap-8">
          <Table label="Bolna agents" head={['Agent', 'Name', 'Id', 'Status', 'Restricted', 'Webhook host']}>
            {d.agents.map((a) => (
              <tr key={a.role} data-testid="agent-row">
                <td className={cell}>{AGENT_LABEL[a.role]}</td>
                <td className={cell}>{a.name ?? a.error ?? '—'}</td>
                <td className={cell}>
                  <Mono>{a.agent_id ?? '—'}</Mono>
                </td>
                <td className={cell}>{a.status ?? '—'}</td>
                <td className={cell}>
                  {a.restricted === null ? '—' : <Flag on={!a.restricted} yes="NOT RESTRICTED" no="RESTRICTED" />}
                </td>
                <td className={cell}>{a.webhook_host ?? '—'}</td>
              </tr>
            ))}
          </Table>
          <dl className="grid grid-cols-[220px_1fr] gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <dt className="text-slate-500">Bolna IP allowlist</dt>
            <dd>
              <Flag on={d.guards.ip_allowlist} />
            </dd>
            <dt className="text-slate-500">Tool secret</dt>
            <dd>
              <Flag on={d.guards.tool_secret} yes="SET" no="MISSING" />
            </dd>
            <dt className="text-slate-500">Bolna API key</dt>
            <dd>
              <Flag on={d.guards.bolna_key} yes="SET" no="MISSING" />
            </dd>
            <dt className="text-slate-500">Sarvam key (coaching layer 2)</dt>
            <dd>
              <Flag on={d.guards.sarvam_key} yes="SET" no="MISSING" />
            </dd>
            <dt className="text-slate-500">Aero Core</dt>
            <dd>
              <Flag on={d.aero_core.ok} yes="HEALTHY" no="DOWN" />
              {d.aero_core.ms !== null ? ` ${d.aero_core.ms} ms` : ''}
            </dd>
            <dt className="text-slate-500">Hub → TiDB mirror backlog</dt>
            <dd>{d.hub.mirror_backlog} rows</dd>
            <dt className="text-slate-500">Open app connections</dt>
            <dd>
              {Object.entries(d.hub.sockets)
                .map(([role, n]) => `${role} ${n}`)
                .join(' · ')}
            </dd>
          </dl>
        </div>
      )}
    </Loaded>
  );
}
