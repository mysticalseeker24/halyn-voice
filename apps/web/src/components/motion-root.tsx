'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/** Every animation in the apps honours the viewer's prefers-reduced-motion setting (docs/UI.md: motion only on state change, < 300 ms). */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Shared entrance: a short rise on state change. Opacity never starts at 0 so the content stays readable. */
export const ENTER = {
  initial: { opacity: 0.3, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: 'easeOut' },
} as const;
