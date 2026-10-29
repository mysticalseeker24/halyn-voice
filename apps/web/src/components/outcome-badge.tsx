'use client';

import type { Outcome } from '@halyn/shared';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// The word is the signal; colour only supports it (docs/UI.md). All pairs are WCAG AA on light and dark.
export const OUTCOME_LABEL: Record<Outcome, string> = {
  allow: 'ALLOWED',
  step_up: 'STEP-UP',
  hold: 'HELD',
  deny: 'DENIED',
};

const STYLE: Record<Outcome, string> = {
  allow: 'bg-emerald-700 text-white',
  step_up: 'bg-amber-400 text-slate-900',
  hold: 'bg-violet-700 text-white',
  deny: 'bg-red-700 text-white',
};

const GLYPH: Record<Outcome, string> = { allow: '✓', step_up: '↑', hold: '‖', deny: '✕' };

export function OutcomeBadge({
  outcome,
  size = 'md',
  className,
}: {
  outcome: Outcome;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <motion.span
      key={outcome}
      initial={{ opacity: 0.4, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      data-outcome={outcome}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-mono font-semibold tracking-[0.06em] whitespace-nowrap',
        size === 'lg' ? 'px-5 py-2 text-2xl' : 'px-3 py-1 text-sm',
        STYLE[outcome],
        className,
      )}
    >
      <span aria-hidden="true">{GLYPH[outcome]}</span>
      {OUTCOME_LABEL[outcome]}
    </motion.span>
  );
}
