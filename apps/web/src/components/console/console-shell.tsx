'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DEMO_CODE_COPY_EN, DemoCodePrompt } from '@/components/demo-code-prompt';
import { HalynMark } from '@/components/halyn-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { ErrorState, LoadingState } from '@/components/states';
import type { ApiClient } from '@/lib/api/client';
import { useDemoSession } from '@/lib/session';
import { cn } from '@/lib/utils';

// Halyn Console for bank teams (docs/UI.md): theme tokens (light / dark), one signal colour. Each page gets the signed-in
// console API client (and the session token, for the Hub stream) from this shell.
export const CONSOLE_PAGES = [
  { href: '/console', label: 'Live' },
  { href: '/console/calls', label: 'Calls' },
  { href: '/console/policies', label: 'Policies' },
  { href: '/console/passes', label: 'Passes' },
  { href: '/console/test', label: 'Test' },
  { href: '/console/signals', label: 'Signals' },
  { href: '/console/ledger', label: 'Ledger' },
  { href: '/console/handoffs', label: 'Handoffs' },
  { href: '/console/integrations', label: 'Integrations' },
] as const;

const active = (path: string, href: string) =>
  href === '/console' ? path === href : path === href || path.startsWith(`${href}/`);

export function ConsoleShell({
  title,
  children,
}: {
  title: string;
  children: (api: ApiClient, token: string | null) => ReactNode;
}) {
  const { state: session, api, token, retry, submitCode } = useDemoSession({ kind: 'console' });
  const path = usePathname();
  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr] bg-background text-foreground">
      <nav aria-label="Console" className="flex flex-col gap-0.5 border-r border-border bg-sidebar p-4">
        <Link
          href="/"
          className="mb-6 flex items-center gap-2 px-2 pt-1 text-lg font-semibold tracking-tight"
        >
          <HalynMark className="size-5" />
          Halyn <span className="font-medium text-muted-foreground">Console</span>
        </Link>
        <p className="mb-2 px-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Operate
        </p>
        {CONSOLE_PAGES.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            aria-current={active(path, page.href) ? 'page' : undefined}
            className={cn(
              'relative flex min-h-10 items-center rounded-md px-3 text-sm transition-colors',
              active(path, page.href)
                ? 'bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)] before:absolute before:top-2.5 before:bottom-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-signal'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {page.label}
          </Link>
        ))}
        <div className="mt-auto px-1 pt-6">
          <ThemeToggle className="w-full justify-center" />
        </div>
      </nav>
      <main className="min-w-0 px-10 py-9">
        <h1 className="mb-8 text-3xl font-semibold tracking-tight">{title}</h1>
        {session.status === 'loading' ? (
          <LoadingState label="Signing in…" />
        ) : session.status === 'needs_code' ? (
          <DemoCodePrompt
            tone="aero"
            rejected={session.rejected}
            onSubmit={submitCode}
            copy={DEMO_CODE_COPY_EN}
          />
        ) : session.status === 'error' ? (
          <ErrorState
            title="Could not sign in to Halyn"
            message={session.message}
            retryLabel="Try again"
            onRetry={retry}
          />
        ) : (
          children(api, token)
        )}
      </main>
    </div>
  );
}
