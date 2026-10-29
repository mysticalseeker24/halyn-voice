'use client';

import type { Region, WsMessage } from '@halyn/shared';
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { DEMO_CODE_COPY_EN, DemoCodePrompt } from '@/components/demo-code-prompt';
import { HalynMark } from '@/components/halyn-mark';
import { ErrorState, LoadingState } from '@/components/states';
import { ThemeToggle } from '@/components/theme-toggle';
import { useHub } from '@/lib/hub/use-hub';
import { useDemoSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  AeroPanel,
  ConfirmPanel,
  DecisionPanel,
  LedgerPanel,
  TimelinePanel,
  TranscriptPanel,
} from './stage-panels';
import { initialStageState, stageReducer } from './stage-state';

export const STAGE_SIZE = { width: 1920, height: 1080 } as const;

// Scenarios 1–4 are the video scenarios (docs/SCENARIOS.md).
export const STAGE_SCENARIOS = [
  { id: '1', label: 'Freeze card' },
  { id: '2', label: 'Fee waiver' },
  { id: '3', label: 'Clone attack' },
  { id: '4', label: 'Coached customer' },
] as const;

/** Fixed 1920×1080 canvas, scaled down (never scrolled) when the window is smaller. */
function useFitScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () =>
      setScale(Math.min(1, window.innerWidth / STAGE_SIZE.width, window.innerHeight / STAGE_SIZE.height));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

/**
 * Recording mode (Step 19): `?recording=1` hides the scenario, region and dev controls and enlarges the type on the
 * same fixed canvas. Escape leaves it.
 */
const RECORDING_EVENT = 'halyn:recording';

function subscribeRecording(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(RECORDING_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(RECORDING_EVENT, onChange);
  };
}

export function useRecordingMode(): [boolean, (on: boolean) => void] {
  // The URL is the store: off on the server, read from location.search in the browser.
  const recording = useSyncExternalStore(
    subscribeRecording,
    () => new URLSearchParams(window.location.search).get('recording') === '1',
    () => false,
  );
  const set = useCallback((on: boolean) => {
    const url = new URL(window.location.href);
    if (on) url.searchParams.set('recording', '1');
    else url.searchParams.delete('recording');
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new Event(RECORDING_EVENT));
  }, []);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, set]);
  return [recording, set];
}

export function StageBoard() {
  const [recording, setRecording] = useRecordingMode();
  const { state: session, api, token, retry, submitCode } = useDemoSession({ kind: 'console' });
  const [state, dispatch] = useReducer(stageReducer, initialStageState);
  const [region, setRegion] = useState<Region>('IN');
  const [running, setRunning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const alive = useRef(true);
  const scale = useFitScale();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadLedger = useCallback(() => {
    Promise.all([api.ledger(), api.ledgerVerify()]).then(
      ([list, verify]) => {
        if (!alive.current) return;
        dispatch({
          type: 'ledger_loaded',
          lines: list.entries.map((e) => ({
            seq: e.seq,
            entry_type: e.type,
            ref_id: e.ref_id,
            hash: e.hash,
            prev_hash: e.prev_hash,
            chain_ok: true,
          })),
        });
        dispatch({ type: 'chain_checked', result: verify });
        setLedgerLoading(false);
        setLedgerError(null);
      },
      (error: unknown) => {
        if (!alive.current) return;
        setLedgerLoading(false);
        setLedgerError(error instanceof Error ? error.message : 'Failed to load the ledger.');
      },
    );
  }, [api]);

  const retryLedger = () => {
    setLedgerError(null);
    setLedgerLoading(true);
    loadLedger();
  };

  useEffect(() => {
    if (session.status === 'ready') loadLedger();
  }, [session.status, loadLedger]);

  const onMessage = useCallback(
    (message: WsMessage) => {
      dispatch({ type: 'ws', message });
      if (message.type === 'test_progress' && message.status !== 'running') {
        setRunning(null);
        api.ledgerVerify().then(
          (result) => alive.current && dispatch({ type: 'chain_checked', result }),
          () => undefined,
        );
      }
    },
    [api],
  );

  const { status: hubStatus } = useHub({
    role: 'stage',
    token,
    getTicket: (role) => api.wsTicket(role).then((r) => r.ticket),
    onMessage,
    onReconnect: loadLedger,
  });

  const run = (id: string) => {
    setActionError(null);
    setRunning(id);
    dispatch({ type: 'run_started' });
    api.stageRun(id, 'text').catch((error: unknown) => {
      setRunning(null);
      setActionError(error instanceof Error ? error.message : 'Could not start the scenario.');
    });
  };

  const switchRegion = (next: Region) => {
    setActionError(null);
    api.stageRegion(next).then(
      () => setRegion(next),
      (error: unknown) => setActionError(error instanceof Error ? error.message : 'Could not switch region.'),
    );
  };

  const demoReset = () => {
    setActionError(null);
    setResetDone(false);
    api.stageDemoReset().then(
      () => setResetDone(true),
      (error: unknown) =>
        setActionError(error instanceof Error ? error.message : 'Could not reset the demo.'),
    );
  };

  const ready = session.status === 'ready';

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <div
        data-testid="stage-canvas"
        data-recording={recording ? 'on' : 'off'}
        className={cn('origin-top-left bg-background text-foreground', recording && 'stage-recording')}
        style={{ width: STAGE_SIZE.width, height: STAGE_SIZE.height, transform: `scale(${scale})` }}
      >
        <header className="flex h-[96px] items-center gap-5 border-b border-border px-8">
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <HalynMark className="size-8" />
            Halyn <span className="font-medium text-muted-foreground">Stage</span>
          </h1>
          {recording ? null : (
            <>
              <div role="group" aria-label="Scenarios" className="flex gap-3">
                {STAGE_SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!ready || running !== null}
                    aria-busy={running === s.id}
                    onClick={() => run(s.id)}
                    className={cn(
                      'min-h-12 rounded-lg px-4 text-base font-medium whitespace-nowrap focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
                      running === s.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-foreground ring-1 ring-border hover:bg-accent',
                    )}
                  >
                    {s.id} · {s.label}
                  </button>
                ))}
              </div>
              <div role="group" aria-label="Region" className="flex rounded-lg bg-muted p-1">
                {(['IN', 'US'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={region === r}
                    disabled={!ready}
                    onClick={() => switchRegion(r)}
                    className={cn(
                      'min-h-10 min-w-14 rounded-md px-3 text-base font-semibold disabled:opacity-50',
                      region === r ? 'bg-foreground text-background' : 'text-foreground',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="font-mono text-xs tracking-[0.12em] whitespace-nowrap text-muted-foreground uppercase">
                Text mode
              </p>
              {actionError ? (
                <p
                  role="alert"
                  className="max-w-[420px] truncate text-base font-semibold text-red-600 dark:text-red-300"
                >
                  {actionError}
                </p>
              ) : null}
              <p role="status" data-hub={hubStatus} className="ml-auto text-sm whitespace-nowrap">
                Hub:{' '}
                <span
                  className={
                    hubStatus === 'open'
                      ? 'font-semibold text-emerald-600 dark:text-emerald-300'
                      : 'font-semibold text-amber-600 dark:text-amber-300'
                  }
                >
                  {hubStatus === 'open' ? 'live' : hubStatus === 'idle' ? 'not connected' : hubStatus}
                </span>
              </p>
              <button
                type="button"
                disabled={!ready}
                onClick={demoReset}
                title="Earlier calls stop counting towards the call-burst signal. Nothing is deleted."
                className="min-h-10 rounded-md px-3 text-sm font-medium whitespace-nowrap text-foreground ring-1 ring-border hover:bg-accent disabled:opacity-50"
              >
                {resetDone ? 'Reset done' : 'Demo reset'}
              </button>
              <button
                type="button"
                onClick={() => setRecording(true)}
                className="min-h-10 rounded-md px-3 text-sm font-medium whitespace-nowrap text-foreground ring-1 ring-border hover:bg-accent"
              >
                Recording mode
              </button>
              <ThemeToggle className="h-10" />
            </>
          )}
        </header>

        {session.status === 'loading' ? (
          <LoadingState label="Signing in to the Hub…" className="text-xl" />
        ) : session.status === 'needs_code' ? (
          <DemoCodePrompt
            tone="stage"
            rejected={session.rejected}
            onSubmit={submitCode}
            copy={DEMO_CODE_COPY_EN}
            className="max-w-[640px] text-xl"
          />
        ) : session.status === 'error' ? (
          <ErrorState
            title="Could not sign in to Halyn"
            message={session.message}
            retryLabel="Try again"
            onRetry={retry}
            className="text-xl"
          />
        ) : (
          <main className="grid h-[calc(1080px-96px)] grid-cols-[440px_1fr_1fr] grid-rows-[1fr_190px] gap-5 p-5">
            <div className="row-span-1 min-h-0">
              <AeroPanel state={state} />
            </div>
            <div className="flex min-h-0 flex-col gap-5">
              <TranscriptPanel state={state} />
              <ConfirmPanel state={state} />
            </div>
            <div className="flex min-h-0 flex-col gap-5">
              <DecisionPanel state={state} />
              <LedgerPanel state={state} loading={ledgerLoading} error={ledgerError} onRetry={retryLedger} />
            </div>
            <div className="col-span-3">
              <TimelinePanel state={state} />
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
