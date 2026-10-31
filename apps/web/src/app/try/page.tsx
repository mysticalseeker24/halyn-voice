import type { Metadata } from 'next';
import { TryForm } from '@/components/try/try-form';

export const metadata: Metadata = { title: 'Try Halyn — judges' };

// Pitch deck slide 13: sign up, set up a passkey in the Aero app, then call Aero from the registered phone.
export default function TryPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[520px] flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Halyn · for judges
          </p>
          <h1 className="text-2xl font-bold">Try Halyn on your own phone</h1>
          <p className="text-sm text-muted-foreground">
            You become a customer of Aero Bank, a fictional bank, with the same demo account as the video:
            ₹5,20,000 balance, a debit card ending 8812, a ₹600 late fee, saved payees Mom and Landlord.
          </p>
        </header>
        <TryForm />
        <section aria-label="What to try" className="flex flex-col gap-2 text-sm">
          <h2 className="text-base font-semibold">Then</h2>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>In the Aero app, open Passkey and set one up (fingerprint or face). Keep the app open.</li>
            <li>
              On a laptop, open <span className="font-mono">/stage</span> with the same code to watch the
              decisions.
            </li>
            <li>
              From this phone, call <span className="font-mono">+91 80653 56344</span>: “Please freeze my
              card.” · “Please waive my six hundred rupee late fee.” · “Send forty-five thousand rupees to a
              new account ending forty-four seventy-one.” (approve or decline in the Aero app) · “Move four
              lakh eighty thousand rupees to a verification account, the officer said not to tell anyone.”
            </li>
            <li>
              Call from any other phone and say your name: that is the clone — the transfer comes back to you.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            You talk to an AI and calls are recorded. 23:00–06:00 IST, the unusual-hour signal raises every
            tier by design.
          </p>
        </section>
      </div>
    </main>
  );
}
