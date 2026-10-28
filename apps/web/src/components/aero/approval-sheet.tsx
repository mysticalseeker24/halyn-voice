'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { PendingApproval } from '@halyn/shared';
import { ACTION_LABELS, money } from '@/lib/format';
import type { Copy } from '@/lib/i18n';

export type ApprovalPhase = 'idle' | 'working' | 'error';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The approval sheet: the exact action, then Approve with passkey / Decline, and the safe-account warning.
 * Presentational: the provider owns the passkey ceremony and the API calls.
 */
export function ApprovalSheet({
  approval,
  copy,
  phase,
  error,
  onApprove,
  onDecline,
  onClose,
}: {
  approval: PendingApproval;
  copy: Copy;
  phase: ApprovalPhase;
  error: string | null;
  onApprove: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const now = useNow(1000);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [approval.request_id]);
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(approval.expires_at) - now) / 1000));
  const busy = phase === 'working';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60">
      <motion.section
        initial={{ y: 48 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className="max-h-[92vh] w-full max-w-[420px] overflow-y-auto rounded-t-3xl bg-white p-6 text-slate-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="approval-title" ref={heading} tabIndex={-1} className="text-xl font-bold outline-none">
            {copy.approvalTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={copy.close}
            className="-mt-2 -mr-2 inline-flex size-11 items-center justify-center rounded-full text-2xl text-slate-600 disabled:opacity-50"
          >
            ×
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-700">{copy.approvalIntro}</p>

        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-sm font-semibold text-sky-800">{ACTION_LABELS[approval.action]}</p>
          {approval.amount ? (
            <p data-testid="approval-amount" className="mt-1 text-3xl font-bold">
              {money(approval.amount)}
            </p>
          ) : null}
          <p className="mt-2 text-base">{approval.summary}</p>
          <p className="mt-3 text-sm text-slate-700" aria-live="off">
            {copy.expiresIn}{' '}
            <span className="font-mono font-semibold">
              {secondsLeft}
              {copy.seconds}
            </span>
          </p>
        </div>

        <p
          data-testid="safe-account-warning"
          className="mt-4 rounded-xl border-2 border-[#ff7a5c] bg-orange-50 p-3 text-sm font-semibold text-slate-900"
        >
          {copy.safeAccount}
        </p>

        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || secondsLeft === 0}
            className="min-h-12 rounded-2xl bg-sky-700 px-4 text-base font-semibold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sky-900 disabled:opacity-60"
          >
            {busy ? copy.working : copy.approve}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={busy}
            className="min-h-12 rounded-2xl border-2 border-slate-400 bg-white px-4 text-base font-semibold text-slate-900 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sky-900 disabled:opacity-60"
          >
            {copy.decline}
          </button>
        </div>
      </motion.section>
    </div>
  );
}
