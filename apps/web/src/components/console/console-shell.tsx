'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DEMO_CODE_COPY_EN, DemoCodePrompt } from '@/components/demo-code-prompt';
import { ErrorState, LoadingState } from '@/components/states';
import type { ApiClient } from '@/lib/api/client';
import { useDemoSession } from '@/lib/session';
import { cn } from '@/lib/utils';

// Halyn Console for bank teams (docs/UI.md): ink on off-white, one indigo accent. The pages grow in Step 13; each
// gets the signed-in console API client from this shell.
export const CONSOLE_PAGES = [
  { href: '/console', label: 'Overview' },
  { href: '/console/handoffs', label: 'Handoffs' },
] as const;

export function ConsoleShell({
  title,
  children,
}: {
  title: string;
  children: (api: ApiClient) => ReactNode;
}) {
  const { state: session, api, retry, submitCode } = useDemoSession({ kind: 'console' });
  const path = usePathname();
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr] bg-stone-50 text-slate-900">
      <nav aria-label="Console" className="flex flex-col gap-1 border-r border-slate-200 p-4">
        <p className="mb-4 text-lg font-semibold">
          Halyn <span className="text-indigo-600">Console</span>
        </p>
        {CONSOLE_PAGES.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            aria-current={path === page.href ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center rounded-md px-3 text-sm',
              path === page.href ? 'bg-indigo-600 font-medium text-white' : 'hover:bg-slate-200',
            )}
          >
            {page.label}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 p-8">
        <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
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
          children(api)
        )}
      </main>
    </div>
  );
}
