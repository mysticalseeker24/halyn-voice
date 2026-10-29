'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

// Light / dark for every Halyn page. The choice is a per-viewer convenience in localStorage (`halyn.theme`); without
// one the page follows the system (layout.tsx sets the class before paint, so there is no flash).
export const THEME_KEY = 'halyn.theme';

/** Runs in <head> before paint: the stored choice, else the system preference. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

const listeners = new Set<() => void>();

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isDark,
    () => false,
  );
  const toggle = useCallback(() => {
    const next = !isDark();
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      // not remembered
    }
    for (const listener of listeners) listener();
  }, []);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'border-border text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-2 rounded-md border px-3 font-mono text-xs tracking-wide uppercase transition-colors',
        className,
      )}
    >
      <span aria-hidden className="bg-foreground inline-block size-2 rounded-full" />
      {dark ? 'Light' : 'Dark'}
    </button>
  );
}
