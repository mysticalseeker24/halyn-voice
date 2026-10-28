'use client';

import { type FormEvent, useId, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DemoCodeCopy {
  label: string;
  hint: string;
  cta: string;
  bad: string;
}

export const DEMO_CODE_COPY_EN: DemoCodeCopy = {
  label: 'Demo access code',
  hint: 'This demo is private. Enter the access code you were given.',
  cta: 'Continue',
  bad: 'That code was not accepted. Check it and try again.',
};

/**
 * One field asking for the demo access code (the API requires `x-demo-code` when DEMO_ACCESS_CODE is set).
 * The parent stores the code in sessionStorage and signs in again; the code is never a build-time value.
 */
export function DemoCodePrompt({
  copy,
  rejected,
  onSubmit,
  tone,
  className,
}: {
  copy: DemoCodeCopy;
  rejected: boolean;
  onSubmit: (code: string) => void;
  tone: 'aero' | 'stage';
  className?: string;
}) {
  const [code, setCode] = useState('');
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) onSubmit(code);
  };
  const stage = tone === 'stage';
  return (
    <form
      onSubmit={submit}

      className={cn('flex flex-col gap-3 p-4', className)}
    >
      <label htmlFor={id} id={`${id}-label`} className="text-base font-semibold">
        {copy.label}
      </label>
      <p id={`${id}-hint`} className="text-sm">
        {copy.hint}
      </p>
      <input
        id={id}
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-describedby={`${id}-hint`}
        aria-invalid={rejected}
        className={cn(
          'min-h-11 rounded-lg border-2 px-3 font-mono text-base',
          stage ? 'border-slate-400 bg-slate-900 text-slate-50' : 'border-slate-500 bg-white text-slate-900',
        )}
      />
      {rejected ? (
        <p role="alert" className={cn('text-sm font-semibold', stage ? 'text-red-300' : 'text-red-700')}>
          {copy.bad}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!code.trim()}
        className={cn(
          'min-h-11 self-start rounded-xl px-5 text-base font-semibold disabled:opacity-60',
          stage ? 'bg-indigo-600 text-white' : 'bg-sky-700 text-white',
        )}
      >
        {copy.cta}
      </button>
    </form>
  );
}
