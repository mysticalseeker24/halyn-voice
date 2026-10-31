'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, createApiClient } from '@/lib/api/client';
import { storeJudgeSession } from '@/lib/session';

// /try (pitch deck slide 13): a judge becomes an Aero Bank customer of their own — the judge access code, their name
// and the phone they will call from — then lands in the Aero app as that customer. Halyn never calls their number.

const api = createApiClient();

/** Ten Indian digits get +91; a number typed with + and a country code stays as it is. */
export function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

const field =
  'min-h-11 rounded-lg border-2 border-input bg-card px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export function TryForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await api.judgeSignup({ code: code.trim(), name: name.trim(), phone: toE164(phone) });
      storeJudgeSession(code, session);
      router.push('/aero');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That access code was not accepted.'
          : err instanceof ApiError && err.status === 400
            ? 'Check your name and number (for India, 10 digits; otherwise start with + and the country code).'
            : 'Something went wrong. Try again in a moment.',
      );
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Access code
        <input
          className={`${field} font-mono`}
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Your name (the agent greets you by it)
        <input
          className={field}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Your mobile number (the phone you will call from)
        <input
          className={`${field} font-mono`}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="10-digit mobile, or + country code"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !code.trim() || !name.trim() || !phone.trim()}
        className="min-h-11 rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground disabled:opacity-60"
      >
        {busy ? 'Creating your account…' : 'Create my Aero Bank account'}
      </button>
      <p className="text-xs text-muted-foreground">
        Your number is stored only as a salted hash and its last 4 digits, so Aero can recognise you when you
        call. Halyn never calls it: confirmations go to the passkey in your Aero app.
      </p>
    </form>
  );
}
