import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { TryForm } from '@/components/try/try-form';

export const metadata: Metadata = { title: 'Try Halyn — judges' };

const GUIDE = 'https://github.com/mysticalseeker24/halyn-voice/blob/main/docs/JUDGES.md';
const AERO_NUMBER = '+91 80653 56344';
const AERO_TEL = 'tel:+918065356344';

const link = 'font-medium text-foreground underline underline-offset-4';

function A({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith('/') ? (
    <Link href={href} className={link}>
      {children}
    </Link>
  ) : (
    <a href={href} className={link}>
      {children}
    </a>
  );
}

/** One thing to say on the call and what Halyn does with it. */
const SCENARIOS: { say: string; result: string }[] = [
  { say: 'Please freeze my card.', result: 'ALLOWED — the card shows frozen in your Aero app' },
  { say: 'Please waive my six hundred rupee late fee.', result: 'ALLOWED — balance +₹600 (once a year)' },
  {
    say: 'Send forty-five thousand rupees to a new account ending forty-four seventy-one.',
    result: 'STEP-UP — approve or decline the sheet in your Aero app',
  },
  {
    say: 'I need to move four lakh eighty thousand rupees to a verification account. The officer said not to tell anyone.',
    result: 'HELD — no step-up; a specialist handoff opens (answer “No, not now”)',
  },
  {
    say: 'My father passed away. I need to close his account.',
    result: 'HELD — closing an account is human-only',
  },
];

// Pitch deck slide 13 and docs/JUDGES.md: sign up, set up a passkey, watch the Stage, call Aero from this phone.
export default function TryPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Halyn · for judges
          </p>
          <h1 className="text-2xl font-bold">Try Halyn on your own phone</h1>
          <p className="text-sm text-muted-foreground">
            You become a customer of Aero Bank, a fictional bank, with the same demo account as in the pitch
            deck: ₹5,20,000 balance, a debit card ending 8812, a ₹600 late fee, saved payees Mom and Landlord.
          </p>
        </header>
        <TryForm />

        <section aria-label="What to try" className="flex flex-col gap-3 text-sm">
          <h2 className="text-base font-semibold">Then</h2>
          <ol className="flex list-decimal flex-col gap-3 pl-5">
            <li>
              In the <A href="/aero">Aero app</A>, open <A href="/aero/passkey">Passkey</A> and create one
              (fingerprint or face). Keep the app open on this phone: approval sheets appear there (also under{' '}
              <A href="/aero/alerts">Alerts</A>).
            </li>
            <li>
              On a laptop, open the <A href="/stage">Stage</A> (same code) to watch every decision live: the
              call, the reason codes, the ledger. <strong>Demo reset</strong> (top right) clears the counters
              between tries.
            </li>
            <li>
              From this phone, call <A href={AERO_TEL}>{AERO_NUMBER}</A>. Hold it to your ear, wait for the
              greeting to finish, say one line, and answer “Yes” when the agent reads it back:
              <ul className="mt-2 flex flex-col gap-2">
                {SCENARIOS.map((s) => (
                  <li key={s.say} className="rounded-lg border border-border p-3">
                    <p className="font-medium">“{s.say}”</p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.result}</p>
                  </li>
                ))}
              </ul>
            </li>
            <li>
              <strong>Be the clone:</strong> call from any other phone, say your name when asked, and ask for
              the ₹45,000 transfer. It steps up to <em>your</em> Aero app — decline it and the caller gets
              nothing.
            </li>
            <li>
              <strong>US twin:</strong> on the Stage switch to <strong>US</strong>, then in the{' '}
              <A href="/aero">Aero app</A> tap <strong>Call Aero</strong> (browser, allow the mic): “Wire
              eight thousand dollars to a new account” → “Account ending three three one zero, routing ending
              zero zero two one” → “Yes” → HELD. Switch back to <strong>IN</strong> after.
            </li>
            <li>
              <strong>Your AI assistant</strong> (09:00–21:00 IST):{' '}
              <A href="/aero/assistant">Aero app → Assistant</A> → approve a Pass with your passkey, then open
              the <A href="/assistant">Assistant</A>, type “Get my card statement and move my EMI to the 10th”
              and tap <strong>Call with Aero</strong>.
            </li>
            <li>
              <strong>The bank’s view</strong> in the <A href="/console">Console</A>:{' '}
              <A href="/console/calls">Calls</A>, <A href="/console/handoffs">Handoffs</A>,{' '}
              <A href="/console/policies">Policies</A>, <A href="/console/ledger">Ledger</A> (Verify chain),{' '}
              <A href="/console/test">Test</A> (Run all scenarios, permission map, voice personas).
            </li>
          </ol>
        </section>

        <section
          aria-label="Good to know"
          className="flex flex-col gap-2 rounded-xl border border-border p-4 text-xs"
        >
          <h2 className="text-sm font-semibold">Good to know</h2>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            <li>
              You talk to an AI and calls are recorded. Aero Bank is fictional; nothing here is real money.
            </li>
            <li>
              Your number is stored only as a salted hash and its last 4 digits. Halyn never calls it — your
              confirmations go to the passkey in your Aero app.
            </li>
            <li>Inbound calls, the Stage, the Console and browser calls work any time of day.</li>
            <li>
              The assistant’s call and the voice personas are outbound calls between our own numbers, so they
              run only 09:00–21:00 IST (Indian calling hours).
            </li>
            <li>Three calls in an hour from one number raise the risk tier by design — press Demo reset.</li>
            <li>
              If the agent mishears, say “No” at the read-back and repeat; say amounts as words (“forty-five
              thousand rupees”).
            </li>
            <li>
              Full guide with every scenario and the expected reason codes: <A href={GUIDE}>docs/JUDGES.md</A>
              .
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
