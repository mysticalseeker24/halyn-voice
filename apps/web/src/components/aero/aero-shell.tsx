'use client';

import type { Language } from '@halyn/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DemoCodePrompt } from '@/components/demo-code-prompt';
import { cn } from '@/lib/utils';
import { AeroProvider, useAero } from './aero-provider';

export function LangToggle({
  lang,
  onChange,
  label,
}: {
  lang: Language;
  onChange: (l: Language) => void;
  label: string;
}) {
  const options: { id: Language; text: string; aria: string }[] = [
    { id: 'hi', text: 'हिन्दी', aria: 'हिन्दी' },
    { id: 'en', text: 'English', aria: 'English' },
  ];
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-sky-100 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          lang={o.id}
          aria-pressed={lang === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'min-h-11 min-w-11 rounded-full px-3 text-sm font-semibold',
            lang === o.id ? 'bg-sky-700 text-white' : 'text-sky-900',
          )}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { lang, setLang, copy, hubStatus, pending, demoCode } = useAero();
  const path = usePathname();
  const tabs = [
    { href: '/aero', label: copy.home },
    { href: '/aero/alerts', label: copy.alerts, badge: pending.length },
    { href: '/aero/passkey', label: copy.passkey },
    { href: '/aero/assistant', label: copy.assistantTab },
  ];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-sky-100 bg-white px-4 py-2">
        <span className="text-lg font-bold text-sky-700">{copy.appName}</span>
        <LangToggle lang={lang} onChange={setLang} label={copy.language} />
      </header>
      {hubStatus === 'reconnecting' ? (
        <p role="status" className="bg-amber-100 px-4 py-1 text-center text-sm font-medium text-slate-900">
          {copy.offline}
        </p>
      ) : null}
      <div className="flex-1 pb-20">
        {demoCode ? (
          <DemoCodePrompt
            tone="aero"
            rejected={demoCode.rejected}
            onSubmit={demoCode.submit}
            className="text-slate-900"
            copy={{
              label: copy.demoCodeLabel,
              hint: copy.demoCodeHint,
              cta: copy.demoCodeCta,
              bad: copy.demoCodeBad,
            }}
          />
        ) : (
          children
        )}
      </div>
      <nav
        aria-label="Aero"
        className="fixed bottom-0 left-1/2 flex w-full max-w-[420px] -translate-x-1/2 border-t border-sky-100 bg-white"
      >
        {tabs.map((tab) => {
          const current = path === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-1 items-center justify-center gap-1 text-sm font-semibold',
                current
                  ? 'border-t-4 border-[#ff7a5c] text-sky-800'
                  : 'border-t-4 border-transparent text-slate-700',
              )}
            >
              {tab.label}
              {tab.badge ? (
                <span className="rounded-full bg-[#ff7a5c] px-2 text-xs font-bold text-slate-900">
                  {tab.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function AeroShell({ children }: { children: ReactNode }) {
  return (
    <AeroProvider>
      <Shell>{children}</Shell>
    </AeroProvider>
  );
}
