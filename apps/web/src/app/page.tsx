import type { Outcome } from '@halyn/shared';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HalynMark } from '@/components/halyn-mark';
import { OutcomeBadge } from '@/components/outcome-badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { APPS } from '@/lib/apps';

// The front door (docs/UI.md): what Halyn is in one screen, then a clear map of the four apps this project ships, so a
// judge knows where to click first. Halyn brand: ink on paper (or near-black), one signal colour, mono labels.

const REPO = 'https://github.com/mysticalseeker24/halyn-voice';
const NUMBER_A = '+91 80653 56344';

const DECISIONS: { title: string; detail: string; outcomes: Outcome[]; tilt: string }[] = [
  {
    title: 'Freeze the card ending 8812',
    detail: 'Registered number · protective',
    outcomes: ['allow'],
    tilt: 'md:-rotate-2 md:translate-y-6',
  },
  {
    title: 'Send ₹45,000 to a NEW payee',
    detail: 'Cloned voice, unknown phone · customer declined',
    outcomes: ['step_up', 'deny'],
    tilt: 'md:z-10 md:scale-105',
  },
  {
    title: 'Move ₹4.8 lakh to a "verification account"',
    detail: 'Real customer, coached · specialist',
    outcomes: ['hold'],
    tilt: 'md:rotate-2 md:translate-y-6',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'The agent proposes',
    body: 'The voice agent collects the details, reads them back and calls propose_action. It has no tool that executes anything.',
  },
  {
    n: '02',
    title: 'Halyn decides',
    body: "The Gate maps the action to a tier from the bank's policy. Proof and signals can only raise it. Voice is never proof.",
  },
  {
    n: '03',
    title: 'Only Halyn executes',
    body: 'An Ed25519 grant, bound to the exact parameters, valid ≤ 120 s, used once. The bank refuses every write without one.',
  },
];

const CALLERS = [
  {
    who: 'A cloned voice',
    why: 'Biometrics can be fooled; known details are not secret.',
    what: 'Risky actions need a passkey on the real customer’s phone or a callback to the registered number.',
  },
  {
    who: 'An AI assistant',
    why: 'Banks hang up on bots, or cannot check what they may do.',
    what: 'Halyn Pass: a signed, scoped permission, spoken as a one-time code.',
  },
  {
    who: 'A coached customer',
    why: 'Every check passes, and the victim approves the step-up.',
    what: 'Coaching signals put the request on hold for a human — never a step-up.',
  },
];

const APP_DETAIL: Record<(typeof APPS)[number]['href'], { what: string; first: string }> = {
  '/stage': {
    what: 'The live view of every decision: the call, the confirmation, the reason codes, the ledger.',
    first: 'Start here. Press a scenario button to watch Halyn decide.',
  },
  '/console': {
    what: 'For the bank: live requests, calls, policies, Passes, the ledger, handoffs and Halyn Test.',
    first: 'Open Policies to see every action’s tier, then Test to run the scenarios.',
  },
  '/aero': {
    what: 'The customer’s banking app on their phone: balance, card, approvals with a passkey, alerts.',
    first: 'Open it on a phone; a step-up arrives here as an approval sheet.',
  },
  '/assistant': {
    what: 'An AI agent that calls the bank for the customer, carrying a Halyn Pass.',
    first: 'Give it a task and watch two agents talk.',
  },
};

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
      <span aria-hidden className="bg-foreground inline-block size-1.5" />
      {children}
    </p>
  );
}

export default function HomePage() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border/70 sticky top-0 z-20 border-b backdrop-blur-sm">
        <div className="bg-background/85 mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <HalynMark className="size-6" />
            <span className="text-lg">Halyn</span>
          </Link>
          <nav
            aria-label="Sections"
            className="text-muted-foreground hidden items-center gap-6 text-sm md:flex"
          >
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#apps" className="hover:text-foreground">
              The apps
            </a>
            <a href="#callers" className="hover:text-foreground">
              Why
            </a>
            <a href={REPO} className="hover:text-foreground">
              GitHub
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            {/* Judges sign up as their own demo customer and call Aero from their phone (docs/JUDGES.md). */}
            <Link
              href="/try"
              className="border-border hover:bg-muted inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
            >
              Try Halyn
            </Link>
            <Link
              href="/stage"
              className="bg-primary text-primary-foreground hidden h-9 items-center rounded-md px-4 text-sm font-medium sm:inline-flex"
            >
              Open the Stage
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--grid)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
          />
          <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 text-center sm:px-8 sm:pt-28">
            <div className="flex justify-center">
              <Label>The permission layer for voice agents</Label>
            </div>
            <h1 className="mx-auto mt-6 max-w-4xl text-5xl leading-[0.95] font-semibold tracking-[-0.04em] text-balance sm:text-7xl lg:text-8xl">
              Don&apos;t trust the voice. Trust the permission
              <span className="text-signal">.</span>
            </h1>
            <p className="text-muted-foreground mx-auto mt-7 max-w-2xl text-lg text-pretty sm:text-xl">
              A voice agent can only <em className="text-foreground not-italic">propose</em> an action. Halyn
              decides — allow, step-up, hold or deny — from policy, proof and signals, and only Halyn can
              execute it.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={`tel:${NUMBER_A.replaceAll(' ', '')}`}
                className="bg-primary text-primary-foreground inline-flex h-12 items-center gap-3 rounded-md px-6 text-base font-medium"
              >
                Call Aero Bank
                <span className="font-mono text-sm opacity-80">{NUMBER_A}</span>
              </a>
              <Link
                href="/stage"
                className="border-border bg-card hover:bg-accent inline-flex h-12 items-center rounded-md border px-6 text-base font-medium"
              >
                Watch decisions live →
              </Link>
            </div>
            <p className="text-muted-foreground mt-4 font-mono text-xs">
              Aero Bank is a fictional demo bank · calls are answered by an AI and recorded
            </p>

            <ul aria-label="Example decisions" className="mt-16 grid gap-4 text-left md:grid-cols-3 md:gap-0">
              {DECISIONS.map((d) => (
                <li
                  key={d.title}
                  className={`border-border bg-card rounded-xl border p-5 shadow-[0_1px_0_var(--grid),0_12px_32px_-12px_rgb(0_0_0/0.18)] ${d.tilt}`}
                >
                  <p className="font-medium">{d.title}</p>
                  <p className="text-muted-foreground mt-1 text-sm">{d.detail}</p>
                  <div className="mt-4 flex items-center gap-2">
                    {d.outcomes.map((o, i) => (
                      <span key={o} className="flex items-center gap-2">
                        {i > 0 ? (
                          <span aria-hidden className="text-muted-foreground">
                            →
                          </span>
                        ) : null}
                        <OutcomeBadge outcome={o} />
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="border-border border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 md:grid-cols-[1fr_2fr]">
            <div>
              <Label>How it works</Label>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                The agent talks. Halyn holds the keys.
              </h2>
            </div>
            <ol className="border-border grid border-t md:grid-cols-3 md:border-t-0 md:border-l">
              {STEPS.map((s) => (
                <li
                  key={s.n}
                  className="border-border border-b py-6 md:border-r md:border-b-0 md:px-6 md:py-0"
                >
                  <p className="text-signal font-mono text-sm">{s.n}</p>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
            <figure className="border-border bg-card overflow-hidden rounded-xl border md:col-span-2">
              <Image
                src="/pipeline.png"
                alt="A voice waveform enters a gate; only a signed line continues to the bank, while other requests branch to step-up, hold or deny"
                width={1600}
                height={995}
                className="w-full dark:hue-rotate-180 dark:invert"
              />
            </figure>
          </div>
        </section>

        <section id="apps" className="border-border bg-card border-t">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <Label>Try it — four apps, one system</Label>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Where to click first
                </h2>
              </div>
              <p className="text-muted-foreground max-w-md text-sm">
                Judges: start with{' '}
                <Link href="/try" className="text-foreground underline underline-offset-4">
                  Try Halyn
                </Link>{' '}
                — your own demo account in a minute — then call Aero Bank from your phone with the Stage open.
                The apps ask for an access code (on request); Halyn never shows real customer data.
              </p>
            </div>
            <ol className="mt-10 grid gap-4 md:grid-cols-2">
              {APPS.map((app, i) => (
                <li key={app.href}>
                  <Link
                    href={app.href}
                    className="group border-border bg-background hover:border-foreground/40 flex h-full flex-col rounded-xl border p-6 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-muted-foreground font-mono text-xs tracking-[0.14em] uppercase">
                        {String(i + 1).padStart(2, '0')} · {app.audience}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">{app.href}</span>
                    </div>
                    <h3 className="mt-4 text-2xl font-semibold tracking-tight">{app.name}</h3>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {APP_DETAIL[app.href].what}
                    </p>
                    <p className="mt-6 text-sm font-medium">
                      {APP_DETAIL[app.href].first}{' '}
                      <span
                        aria-hidden
                        className="inline-block transition-transform group-hover:translate-x-0.5"
                      >
                        →
                      </span>
                    </p>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="callers" className="border-border border-t">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <Label>Why it needs to exist</Label>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Three callers break today&apos;s checks. Halyn has an answer for each.
            </h2>
            <div className="border-border mt-10 grid border-t md:grid-cols-3">
              {CALLERS.map((c) => (
                <div
                  key={c.who}
                  className="border-border border-b py-6 md:border-r md:border-b-0 md:px-6 md:first:pl-0"
                >
                  <h3 className="text-lg font-semibold">{c.who}</h3>
                  <p className="text-muted-foreground mt-2 text-sm">{c.why}</p>
                  <p className="mt-4 text-sm leading-relaxed">{c.what}</p>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-10 max-w-3xl text-sm">
              Deepfake fraud attempts rose 1,300% in 2024 (Pindrop). US consumers reported $12.5B lost to
              fraud in 2024 (FTC). About ₹120 crore was lost to “digital arrest” scams in early 2024 (The
              Wire).
            </p>
          </div>
        </section>

        <section className="border-border bg-card border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center">
            <p className="text-muted-foreground font-mono text-xs tracking-[0.14em] uppercase md:w-48">
              Built with
            </p>
            <ul className="text-muted-foreground flex flex-wrap gap-x-10 gap-y-3 text-lg font-medium">
              {['Bolna', 'Sarvam', 'Cloudflare Workers', 'TiDB', 'Vercel'].map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm sm:flex-row sm:items-center sm:px-8">
          <span className="flex items-center gap-2 font-medium">
            <HalynMark className="size-5" /> Halyn
          </span>
          <span className="opacity-70">Bolna Symphony Buildathon 2026 · built by Saksham Mishra</span>
          <span className="flex gap-6 opacity-80 sm:ml-auto">
            <a href={REPO} className="hover:opacity-100">
              GitHub
            </a>
            <a href={`${REPO}#readme`} className="hover:opacity-100">
              README
            </a>
            <a href={`${REPO}/blob/main/docs/PASS.md`} className="hover:opacity-100">
              Halyn Pass
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
