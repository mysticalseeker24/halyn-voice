'use client';

import { motion } from 'framer-motion';
import { ENTER } from '@/components/motion-root';
import { istTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EmptyState } from './states';

export interface TimelineItem {
  id: string;
  at: string;
  kind: string;
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'hold';
}

const TONE: Record<NonNullable<TimelineItem['tone']>, string> = {
  neutral: 'border-slate-400',
  good: 'border-emerald-500',
  warn: 'border-amber-400',
  bad: 'border-red-500',
  hold: 'border-violet-400',
};

export function EventTimeline({ items, max = 8 }: { items: readonly TimelineItem[]; max?: number }) {
  if (items.length === 0) return <EmptyState>Events appear here as they happen.</EmptyState>;
  return (
    <ol aria-label="Event timeline" className="flex gap-3">
      {items.slice(-max).map((item) => (
        <motion.li
          {...ENTER}
          key={item.id}
          className={cn('min-w-0 flex-1 border-t-4 pt-2', TONE[item.tone ?? 'neutral'])}
        >
          <p className="font-mono text-xs opacity-80">{istTime(item.at)} IST</p>
          <p className="text-sm font-semibold">{item.kind}</p>
          <p className="truncate text-sm opacity-90" title={item.label}>
            {item.label}
          </p>
        </motion.li>
      ))}
    </ol>
  );
}
