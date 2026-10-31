'use client';

import type { ActionId, PassScope, PassSummary } from '@halyn/shared';
import { type PublicKeyCredentialRequestOptionsJSON, startAuthentication } from '@simplewebauthn/browser';
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, LoadingState } from '@/components/states';
import type { Copy } from '@/lib/i18n';
import { useAero } from './aero-provider';

// Assistant access (docs/UI.md, docs/PASS.md): the customer authorises their AI assistant for a few Pass-eligible
// tasks and approves with their passkey; every Pass can be revoked in one tap. Critical actions are never offered.

const SCOPES: { action: ActionId; key: keyof Copy; max_uses?: number }[] = [
  { action: 'statement.view', key: 'scope_statement_view' },
  { action: 'balance.view', key: 'scope_balance_view' },
  { action: 'card.freeze', key: 'scope_card_freeze' },
  { action: 'fee.waive', key: 'scope_fee_waive', max_uses: 1 },
  { action: 'emi.move_date', key: 'scope_emi_move_date', max_uses: 1 },
];

const STATUS_KEY: Record<PassSummary['status'], keyof Copy> = {
  active: 'passActive',
  revoked: 'passRevoked',
  locked: 'passLocked',
  expired: 'passExpired',
};

type Phase = 'idle' | 'working' | 'done' | 'error';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function AssistantAccessView() {
  const { api, copy, home } = useAero();
  const [passes, setPasses] = useState<PassSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("Saksham's Assistant");
  // The Assistant agent calls from number B (Aero's assistant line), so a Pass for it names that number.
  const [number, setNumber] = useState('+918065356379');
  const [chosen, setChosen] = useState<ActionId[]>(['statement.view', 'card.freeze', 'emi.move_date']);
  const [days, setDays] = useState(7);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listPasses().then(
      ({ passes: list }) => {
        setPasses(list);
        // Prefill the assistant's number from an earlier Pass (the demo's number B lives in the data, not the code).
        setNumber((current) => current || list[0]?.assistant_numbers[0] || '');
      },
      (e: unknown) => setLoadError(describe(e)),
    );
  }, [api]);

  useEffect(() => load(), [load]);

  const toggle = (action: ActionId) =>
    setChosen((list) => (list.includes(action) ? list.filter((a) => a !== action) : [...list, action]));

  const authorise = async () => {
    setPhase('working');
    setError(null);
    const scopes: PassScope[] = SCOPES.filter((s) => chosen.includes(s.action)).map((s) =>
      s.max_uses ? { action: s.action, max_uses: s.max_uses } : { action: s.action },
    );
    const draft = {
      assistant: { name: name.trim(), numbers: [number.trim()] },
      scopes,
      expires_in_days: days,
    };
    try {
      const { options } = await api.passOptions(draft);
      const response = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      const { pass } = await api.issuePass(draft, response);
      setPasses((list) => [...(list ?? []), pass]);
      setPhase('done');
    } catch (e) {
      setPhase('error');
      setError(describe(e));
    }
  };

  const revoke = async (id: string) => {
    try {
      const { pass } = await api.revokePass(id);
      setPasses((list) => (list ?? []).map((p) => (p.id === id ? pass : p)));
    } catch (e) {
      setError(describe(e));
    }
  };

  if (loadError)
    return (
      <ErrorState
        title={copy.errorTitle}
        message={loadError}
        retryLabel={copy.retry}
        onRetry={() => {
          setLoadError(null);
          load();
        }}
      />
    );
  if (!passes || home.status === 'loading')
    return <LoadingState label={copy.loading} className="text-foreground" />;
  const registered = home.status === 'ready' && home.data.passkey_registered;

  return (
    <div className="flex flex-col gap-5 p-4">
      <h1 className="text-2xl font-bold text-foreground">{copy.assistantTitle}</h1>
      <p className="text-base text-foreground">{copy.assistantBody}</p>

      <section aria-labelledby="passes-title" className="flex flex-col gap-3">
        <h2 id="passes-title" className="text-lg font-semibold text-foreground">
          {copy.assistantPasses}
        </h2>
        {passes.length === 0 ? <p className="text-muted-foreground">{copy.assistantNone}</p> : null}
        {passes.map((p) => (
          <article key={p.id} data-testid="pass-row" className="rounded-2xl bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-foreground">{p.assistant_name}</p>
              <span
                className={`rounded-full px-2 py-1 text-xs font-bold ${p.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200' : 'bg-muted text-foreground'}`}
              >
                {copy[STATUS_KEY[p.status]]}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {p.scopes
                .map((s) => copy[SCOPES.find((x) => x.action === s.action)?.key ?? 'assistantScopes'])
                .join(' · ')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {copy.passUntil} {new Date(p.expires_at).toLocaleDateString()}
            </p>
            {p.status === 'active' ? (
              <button
                type="button"
                onClick={() => void revoke(p.id)}
                className="mt-3 min-h-11 rounded-xl border border-rose-300 dark:border-rose-800 px-4 text-sm font-semibold text-rose-800 dark:text-rose-300"
              >
                {copy.assistantRevoke}
              </button>
            ) : null}
          </article>
        ))}
      </section>

      <section aria-labelledby="new-pass" className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-sm">
        <h2 id="new-pass" className="text-lg font-semibold text-foreground">
          {copy.assistantTitle}
        </h2>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          {copy.assistantName}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="min-h-11 rounded-xl border border-input px-3 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          {copy.assistantNumber}
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            inputMode="tel"
            placeholder="+91…"
            className="min-h-11 rounded-xl border border-input px-3 text-base"
          />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">{copy.assistantScopes}</legend>
          {SCOPES.map((s) => (
            <label key={s.action} className="flex min-h-11 items-center gap-3 text-base text-foreground">
              <input
                type="checkbox"
                checked={chosen.includes(s.action)}
                onChange={() => toggle(s.action)}
                className="size-5"
              />
              {copy[s.key]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          {copy.assistantExpiry}
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
            className="min-h-11 w-24 rounded-xl border border-input px-3 text-base"
          />
        </label>
        {registered ? null : (
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {copy.assistantNeedsPasskey}
          </p>
        )}
        <button
          type="button"
          onClick={() => void authorise()}
          disabled={
            !registered || phase === 'working' || chosen.length === 0 || !number.trim() || !name.trim()
          }
          className="min-h-12 rounded-2xl bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          {phase === 'working' ? copy.working : copy.assistantCta}
        </button>
        {phase === 'done' ? (
          <p
            role="status"
            className="rounded-xl bg-emerald-100 dark:bg-emerald-950 p-3 font-semibold text-emerald-900 dark:text-emerald-200"
          >
            {copy.assistantIssued}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-rose-100 dark:bg-rose-950 p-3 text-rose-900 dark:text-rose-200"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
