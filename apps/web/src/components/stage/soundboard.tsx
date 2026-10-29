'use client';

import { type Clip, CLIP_DISCLOSURE } from '@halyn/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_CODE_COPY_EN, DemoCodePrompt } from '@/components/demo-code-prompt';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useDemoSession } from '@/lib/session';
import { cn } from '@/lib/utils';

// /stage/soundboard (Step 19): the clone's lines for scenario 3, played from the laptop into the second phone's call.
// Every clip carries the disclosure on screen: it is an AI clone of Saksham's own voice, made with his consent.

export interface SoundboardViewProps {
  clips: readonly Clip[];
  playing: string | null;
  loadingId: string | null;
  onPlay(clip: Clip): void;
  onStop(): void;
}

export function SoundboardView({ clips, playing, loadingId, onPlay, onStop }: SoundboardViewProps) {
  if (clips.length === 0)
    return (
      <EmptyState className="text-lg">
        No clips yet. Render them with <code>scripts/clone-clips.ts</code>, then reload.
      </EmptyState>
    );
  return (
    <ol className="grid gap-4" aria-label="Clone clips">
      {clips.map((clip) => {
        const active = playing === clip.id;
        return (
          <li
            key={clip.id}
            data-testid="clip"
            className={cn(
              'rounded-2xl border p-5',
              active ? 'border-indigo-300 bg-indigo-950/60' : 'border-white/10 bg-white/5',
            )}
          >
            <div className="flex items-start gap-5">
              <button
                type="button"
                onClick={() => (active ? onStop() : onPlay(clip))}
                disabled={loadingId !== null && loadingId !== clip.id}
                aria-busy={loadingId === clip.id}
                className="min-h-14 min-w-32 rounded-xl bg-indigo-600 px-5 text-lg font-semibold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
              >
                {loadingId === clip.id ? 'Loading…' : active ? 'Stop' : 'Play'}
              </button>
              <div className="min-w-0">
                <p className="text-xl font-semibold">
                  {clip.order} · {clip.label}
                </p>
                <p lang="hi" className="mt-1 text-lg text-slate-200">
                  {clip.text}
                </p>
                <p className="mt-2 inline-block rounded-md bg-amber-300 px-2 py-0.5 text-sm font-bold text-slate-950">
                  {CLIP_DISCLOSURE}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type ListState =
  { status: 'loading' } | { status: 'ready'; clips: Clip[] } | { status: 'error'; message: string };

export function Soundboard() {
  const { state: session, api, retry, submitCode } = useDemoSession({ kind: 'console' });
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<string, string>());

  const load = useCallback(() => {
    setList({ status: 'loading' });
    api.clips().then(
      (r) => setList({ status: 'ready', clips: r.clips }),
      (error: unknown) =>
        setList({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load the clips.',
        }),
    );
  }, [api]);

  useEffect(() => {
    if (session.status === 'ready') load();
  }, [session.status, load]);

  useEffect(() => () => audio.current?.pause(), []);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };

  const play = async (clip: Clip) => {
    stop();
    setPlayError(null);
    try {
      let src = cache.current.get(clip.id);
      if (!src) {
        setLoadingId(clip.id);
        const r = await api.clipAudio(clip.id);
        src = `data:${r.content_type};base64,${r.audio_b64}`;
        cache.current.set(clip.id, src);
      }
      const el = new Audio(src);
      el.onended = () => setPlaying((p) => (p === clip.id ? null : p));
      audio.current = el;
      setPlaying(clip.id);
      await el.play();
    } catch (error) {
      setPlaying(null);
      setPlayError(error instanceof Error ? error.message : 'Could not play the clip.');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <main className="mx-auto h-screen max-w-3xl overflow-y-auto bg-[#0b0d17] px-4 py-8 text-slate-50 sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">
        Halyn <span className="text-indigo-300">Stage</span> · Soundboard
      </h1>
      <p className="mt-2 text-lg text-slate-300">
        Scenario 3: the clone&apos;s lines, played into the call from the second phone. {CLIP_DISCLOSURE},
        made with his consent, for this security demo only.
      </p>
      {playError ? (
        <p role="alert" className="mt-4 text-base font-semibold text-red-300">
          {playError}
        </p>
      ) : null}
      <div className="mt-6">
        {session.status === 'loading' || (session.status === 'ready' && list.status === 'loading') ? (
          <LoadingState label="Loading the clips…" className="text-lg" />
        ) : session.status === 'needs_code' ? (
          <DemoCodePrompt
            tone="stage"
            rejected={session.rejected}
            onSubmit={submitCode}
            copy={DEMO_CODE_COPY_EN}
            className="text-lg"
          />
        ) : session.status === 'error' ? (
          <ErrorState
            title="Could not sign in to Halyn"
            message={session.message}
            retryLabel="Try again"
            onRetry={retry}
          />
        ) : list.status === 'error' ? (
          <ErrorState
            title="Could not load the clips"
            message={list.message}
            retryLabel="Try again"
            onRetry={load}
          />
        ) : list.status === 'ready' ? (
          <SoundboardView
            clips={list.clips}
            playing={playing}
            loadingId={loadingId}
            onPlay={(clip) => void play(clip)}
            onStop={stop}
          />
        ) : null}
      </div>
    </main>
  );
}
