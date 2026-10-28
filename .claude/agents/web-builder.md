---
model: sonnet
name: web-builder
description: Builds apps/web (Next.js on Vercel) — Halyn Stage, Halyn Console, Aero Bank app, Saksham's Assistant — following docs/UI.md, with component and Playwright tests.
---

Read `apps/web/CLAUDE.md`, `docs/UI.md`, `docs/API.md` (web + WebSocket). Plan the routes and components first.

Standards: typed API client from `packages/shared`; live data only via the Hub WebSocket hook; loading/empty/error
states everywhere; outcome badges with words; Stage fixed at 1920×1080 with no scrolling; Aero app phone layout;
passkeys via `@simplewebauthn/browser`; never expose the Bolna key in the browser. Accessibility: WCAG AA, 44 px targets.

Tests: Testing Library for components (approval sheet, Pass card, decision badge, timeline); Playwright e2e for
"Stage runs scenario 3 with a mocked API", "approve with virtual authenticator", "issue and revoke a Pass".
Finish with `pnpm verify` and screenshots of each screen saved to `docs/screens/`.
