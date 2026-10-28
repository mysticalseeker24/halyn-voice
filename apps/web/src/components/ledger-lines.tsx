'use client';

import { motion } from 'framer-motion';
import { ENTER } from '@/components/motion-root';
import { cn } from '@/lib/utils';
import { EmptyState } from './states';

export interface LedgerLine {
  seq: number;
  entry_type: string;
  ref_id: string;
  hash: string;
  prev_hash: string;
  chain_ok: boolean;
}

export type ChainStatus =
  | { state: 'unchecked' }
  | { state: 'verified'; entries: number }
  | { state: 'broken'; firstBadSeq: number | null };

export function ChainStatusPill({ status }: { status: ChainStatus }) {
  const text =
    status.state === 'verified'
      ? `Chain verified · ${status.entries} entries`
      : status.state === 'broken'
        ? status.firstBadSeq === null
          ? 'Chain BROKEN'
          : `Chain BROKEN at #${status.firstBadSeq}`
        : 'Chain not checked yet';
  const style =
    status.state === 'verified'
      ? 'bg-emerald-700 text-white'
      : status.state === 'broken'
        ? 'bg-red-700 text-white'
        : 'bg-slate-600 text-white';
  return (
    <span data-chain={status.state} className={cn('rounded-full px-3 py-1 text-sm font-semibold', style)}>
      {status.state === 'verified' ? '✓ ' : status.state === 'broken' ? '✕ ' : ''}
      {text}
    </span>
  );
}

const short = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-4)}`;

export function LedgerLines({ lines, max = 6 }: { lines: readonly LedgerLine[]; max?: number }) {
  if (lines.length === 0) return <EmptyState>No ledger entries yet. Run a scenario.</EmptyState>;
  const shown = lines.slice(-max);
  return (
    <ol aria-label="Ledger" className="flex flex-col gap-1.5">
      {shown.map((line) => (
        <motion.li
          {...ENTER}
          key={line.seq}
          data-seq={line.seq}
          className="grid grid-cols-[3rem_9rem_1fr_auto] items-center gap-3 rounded-md bg-white/5 px-3 py-1.5 font-mono text-sm"
        >
          <span>#{line.seq}</span>
          <span className="font-semibold">{line.entry_type}</span>
          <span title={line.hash}>
            {short(line.prev_hash)} → {short(line.hash)}
          </span>
          <span className={line.chain_ok ? 'text-emerald-300' : 'text-red-300'}>
            {line.chain_ok ? 'linked' : 'BROKEN'}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}
