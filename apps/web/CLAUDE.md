# apps/web — Next.js on Vercel: /stage, /console, /aero, /assistant

Read with: `docs/UI.md`, `docs/API.md` (web + WebSocket sections).

- App Router, TypeScript strict, Tailwind, shadcn/ui, Framer Motion.
- Data: REST via a typed client generated from `packages/shared` schemas; live updates only from the Hub WebSocket
  (`useHub()` hook with reconnect + refetch on reconnect).
- Two brands: Halyn (Stage/Console, dark Stage) and Aero (phone layout, max-width 420 px). Never mix their styles.
- Outcome badges always show the word (ALLOWED / STEP-UP / HELD / DENIED), not only colour.
- Passkeys with `@simplewebauthn/browser`; RP ID = the deployed domain; E2E uses Playwright's virtual authenticator.
- "Call Aero" uses the Bolna Web Call SDK; never put the Bolna API key in the browser — get a short-lived token from the API.
- Every screen has a loading, empty and error state. The Stage must not scroll during a scenario (fixed 1920×1080 layout).
