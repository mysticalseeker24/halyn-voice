# Build prompts — paste into Claude Code, in order

**How to use**
- One step per session where possible (`/clear` between steps keeps context clean; `docs/STATE.md` carries memory).
- After every step: `/verify` → `/review` → `/handoff` → commit when you're happy (`git commit` yourself, or tell Claude to).
- Steps marked 📞 place real calls or spend Bolna credit: run them 09:00–21:00 IST and say "go ahead" when Claude asks.
- If a step goes wrong: "Stop. Write a failing test that reproduces the problem, then fix it."

## Before Step 0 (you, 15 minutes)
1. Unzip into your local clone of `github.com/mysticalseeker24/halyn-voice`, commit "chore: starter docs and Claude setup", push.
2. Create accounts/projects: Cloudflare (Workers free), TiDB Cloud Starter (MySQL, region close to Mumbai) with a `dev` branch, Vercel project linked to the repo (root `apps/web`).
3. In Claude Code: `/mcp` → confirm the Bolna MCP is connected.
4. `cp .env.example .env` and fill what you have (Bolna key, Sarvam key, `CUSTOMER_PHONE`, TiDB URL, a second phone for `SPECIALIST_NUMBER`).

---

### Step 0 — Scaffold the monorepo (Sun night)
```
Read CLAUDE.md, docs/ARCHITECTURE.md and docs/TESTING.md. Scaffold the monorepo exactly as the repo map in CLAUDE.md §4,
with no business logic yet:
- pnpm workspaces + Turborepo; tsconfig.base.json (strict, noUncheckedIndexedAccess); ESLint (flat config) + Prettier;
  an ESLint no-restricted-imports rule so apps/api/src/{gate,grants,ledger,pass} and packages/shared cannot import db/, bolna/, hub/ or any I/O.
- apps/api: Hono on Cloudflare Workers (wrangler.toml with a HubDO Durable Object using SQLite storage, KV `CONFIG`, R2 `FILES`,
  compatibility_date recent, no nodejs_compat unless required).
- apps/aero-core: separate Worker with a D1 binding `DB`.
- apps/web: Next.js App Router + TypeScript + Tailwind + shadcn/ui; route groups stage, console, aero, assistant with placeholder pages.
- packages/shared, packages/sdk: TypeScript libraries built with tsup.
- Vitest everywhere; @cloudflare/vitest-pool-workers for api and aero-core; coverage thresholds from docs/TESTING.md; fast-check installed;
  Playwright in apps/web.
- Root scripts: dev, lint, typecheck, test:unit, test:int, test:scenarios, test:e2e, build, verify (= lint+typecheck+unit+int+scenarios+build),
  compile:packs, keys:generate, db:migrate, seed, deploy:api, deploy:core, deploy:web.
- One placeholder test per package so verify runs.
Use current stable versions; check each tool's docs instead of guessing config. Make CI (.github/workflows/ci.yml) pass.
Done when: pnpm verify is green locally. Then /handoff.
```

### Step 1 — Shared package, test-first (Sun night)
```
Use the api-builder subagent. Build packages/shared test-first from docs/API.md, docs/GATE.md, docs/PASS.md, docs/DATA_MODEL.md:
reason-codes.ts (every code in docs/GATE.md), actions.ts (ActionId union + Zod param schema per action used in policy-packs/*.yaml and
tests/scenarios/scenarios.yaml), money.ts (integer minor units, INR/USD formatting incl. lakh grouping), canonical-json.ts,
policy-pack schema + scripts/compile-packs.ts (YAML → validated JSON in policy-packs/compiled/), Pass and grant claim schemas, API
request/response schemas, ws.ts message union. Property tests: canonical JSON is key-order independent and stable; money never
uses floats and round-trips; every action in the YAML packs has a param schema. Coverage ≥ 95%.
Done when: pnpm verify green, coverage met, compile:packs produces both packs.
```

### Step 2 — The Gate, test-first (Sun night)
```
Use the api-builder subagent, then the test-engineer. Implement apps/api/src/gate as a pure function exactly per docs/GATE.md
(evaluation order, tier table, signals, limits, reason-code rules, post-approval rules) and apps/api/src/signals/coaching-lexicon.ts
(keyword layer only for now; Hindi, English, Hinglish; lexicon in code, never in prompts).
Tests: table-driven unit tests for every row of the tier table and every rule; fast-check properties from docs/GATE.md
(monotonic signals, coaching never allow/step_up on money actions, non-pass-eligible never allowed via Pass, readback=false never
allow on writes, determinism). Add Gate-level assertions for every scenario in tests/scenarios/scenarios.yaml (decision + reasons_include).
Done when: coverage ≥ 95% for gate/, all scenario Gate assertions pass.
```

### Step 3 — Grants, Ledger, Pass core + SDK (Sun night / Mon early)
```
Use the api-builder subagent, then the test-engineer. Pure modules with WebCrypto (Ed25519, SHA-256):
- apps/api/src/grants: signGrant(claims incl. params_hash, exp ≤ 120 s, jti), scripts/keys-generate.ts (Ed25519 JWK + JWKS).
- apps/api/src/ledger: entry canonicalisation, hash chain, verify (returns first bad seq).
- apps/api/src/pass: issue (rejects non-pass-eligible scopes), sign, code mint (6 digits, hashed with pepper, 5 min, bound to number),
  code verify (single use, number binding, 5 failures → lock), revoke.
- packages/sdk: verifyGrant (signature, exp, params hash, expected action), verifyLedger, proposeAction types; README with a 10-line example.
Security tests: tampered payload, wrong key, expired, params mismatch, replayed code, wrong number, locked pass. Property: any single-byte
change to any ledger entry is detected.
Done when: coverage ≥ 95% for grants/, ledger/, pass/, sdk; pnpm verify green.
```

### Step 4 — 📞 Day-0 checks (Mon 09:00)
```
/day0-checks
Before any call: tell me the planned minutes and cost and check the wallet. Ask for my go-ahead.
```

### Step 5 — API Worker, Hub, TiDB (Mon)
```
Use the api-builder subagent. Build the API skeleton from docs/API.md and docs/ARCHITECTURE.md:
env validation (Zod), error handler with reason codes, bolnaGuard (CF-Connecting-IP in BOLNA_SOURCE_IPS AND x-halyn-secret), session
auth for /web, Drizzle mysql schema + migrations for every TiDB table in docs/DATA_MODEL.md (tenant_id on all), scripts/seed.ts
(deterministic, CUSTOMER_PHONE from env), and HubDO (WebSocket Hibernation with role tags, idempotency cache, ordered ledger append that
persists to TiDB, confirmation alarms). Integration tests (Miniflare): guard rejects wrong IP / missing secret; ledger appends stay
ordered under concurrent requests; idempotency returns the same result; alarm fires timeout. Use the TiDB dev branch for DB tests or a
local MySQL container if faster — document the choice in an ADR.
Done when: pnpm verify green and `wrangler dev` serves /health.
```

### Step 6 — Aero Core (Mon)
```
Use the api-builder subagent. Build apps/aero-core per its CLAUDE.md and docs/API.md: D1 schema + seed (accounts, cards, fees, loans,
payees, transactions, used_grants), routes for freeze card, waive fee, move EMI date, transfers, balance, statement. Every route verifies
x-halyn-grant with @halyn/sdk; jti insert and the write happen in one D1 batch. Integration tests for every 401 code and a concurrent
double-spend of one grant (exactly one succeeds). Done when: pnpm verify green.
```

### Step 7 — Tools, events, Confirm, scenario runner (Mon)
```
Use the api-builder subagent, then the test-engineer. Implement the Bolna-facing tools (lookup_customer, verify_pass, propose_action,
get_pass_code, confirm_result, check_decision) and the webhook, the Bolna REST client (events, outbound call, executions; typed; mocked in
tests from tests/fixtures/bolna), Confirm orchestration (passkey prompt over the Hub + Bolna callback in parallel, first answer wins,
60 s alarm → timeout), allow-path execution (sign grant → Aero Core → event done), and the text-mode scenario runner reading
tests/scenarios/scenarios.yaml (real Gate/Pass/Ledger/Aero Core; Bolna and answers simulated). propose_action must answer in ≤ 300 ms and do
slow work in waitUntil. Done when: scenarios 1, 2, 3, 3b, 7, 8, 11, 12 pass in `pnpm test:scenarios`.
```

### Step 8 — 📞 Bolna agents + first real calls (Mon)
```
Use the bolna-voice-engineer subagent. Deploy the API and Aero Core to the dev environment first (pnpm deploy:api / deploy:core).
Then, with my go-ahead: create the Aero graph agent from prompts/aero-agent.md and docs/BOLNA.md (custom functions pointing at the deployed
API with the x-halyn-secret header; event edges exactly as in docs/BOLNA.md), and the Halyn Confirm agent from prompts/confirm-agent.md on
number B with guardrails 9–21 and keypad input. Relink number A to the Aero agent (the old Kavach listener gets unlinked; keep it, don't delete).
Verify restricted=false for both. Save agent JSON to agents/ and ids to docs/STATE.md.
Then voice-smoke scenarios 1, 2 and 3 with me (I'll call; scenario 3 tagged security_demo). Use call-reviewer and compliance-reviewer after.
```

### Step 9 — Web: Aero app + Stage v1 (Mon, can run in parallel with 7–8)
```
Use the web-builder subagent. Build per docs/UI.md: the Hub WebSocket hook (reconnect + refetch), the typed API client, the Aero Bank app
(home with balance/activity/card/loan, alerts, approval sheet with passkey Approve/Decline and the safe-account warning, passkey registration,
Hindi/English toggle) and Stage v1 (scenario buttons 1–4, Aero panel, live call transcript, Confirm panel, Halyn decision panel, ledger lines
with chain status, event timeline; dark; fixed 1920×1080). Component tests and Playwright e2e with a virtual authenticator.
Done when: pnpm verify + test:e2e green; screenshots in docs/screens/.
```

### Step 10 — Pass + Assistant (Tue)
```
Use api-builder, web-builder and bolna-voice-engineer. Implement Pass issue/revoke/list (/web/passes) with passkey consent, the Aero app
"Authorise an assistant" screen, the Assistant app (task box, boarding-pass card, live transcript) and /web/assistant/tasks which starts the
Assistant agent's outbound call (number B → A). Create the Assistant agent from prompts/assistant-agent.md (with my go-ahead).
Done when: scenarios 5 and 6 pass in text mode, then voice-smoke them with me.
```

### Step 11 — Coaching, hold, transfer, handoffs (Tue)
```
Use api-builder and bolna-voice-engineer. Add the Sarvam LLM coaching layer (1.5 s budget, keywords fallback, never in prompts), the hold
outcome (handoff row, event hold, agent protect → transfer to SPECIALIST_NUMBER), the distress path (scenario 9), and a scheduled check-in
call record (no call placed unless I approve). Console Handoffs page (release/block). Done when: scenarios 4 and 9 pass in text mode;
voice-smoke 4 with me (tagged security_demo).
```

### Step 12 — US region (Tue)
```
Use api-builder, web-builder, bolna-voice-engineer. Compile and load the US pack, create the English Aero agent (web only), add the Bolna
Web Call SDK to the Aero app ("Call Aero") using a short-lived token from the API (never expose the key), and the Stage region switch.
No calls to US numbers. Done when: scenario 10 passes in text mode and works as a browser call.
```

### Step 13 — Console (Tue)
```
Use the web-builder subagent. Build Console pages per docs/UI.md: Live, Calls (recording + transcript links), Policies (read-only view of
compiled packs with a "test this pack" button that runs the text scenarios), Passes, Signals, Ledger (verify + export to R2), Integrations
(agent status, restricted flag, guard status). Component tests + e2e for Ledger verify and Pass revoke.
```

### Step 14 — Scenario suite 12/12 + coverage (Tue night)
```
Use the test-engineer subagent. Make all 12 scenarios (+3b) pass in pnpm test:scenarios with the "rules every scenario also checks" from
docs/SCENARIOS.md. Close coverage gaps to the thresholds. Add security tests from docs/TESTING.md that are still missing. Report counts.
```

### Step 15 — Halyn Test UI + permission map (Wed)
```
Use api-builder and web-builder. Console Test page: run the text suite (12 scenarios) and show the scorecard (actions without a grant,
attacks stopped, tasks completed, median reply), run-to-run comparison, and the permission map built from the Aero agent's graph JSON
(every path that reaches propose_action and the event edges that guard outcomes; red if any outcome node is reachable without an event).
Voice mode: benign personas from prompts/personas/README.md only (with my go-ahead). Attacker personas ONLY if docs/STATE.md says Bolna approved.
```

### Step 16 — Hardening (Wed)
```
Run /review on the whole codebase (not just the diff), then the test-engineer for every finding. Then: performance check (propose_action
p95 < 300 ms, Worker CPU < 10 ms), fail-closed drill (API stopped mid-call), log masking audit, secrets scan, dependency audit.
Fix blockers only. Update docs for anything that changed.
```

### Step 17 — 📞 Demo environment (Wed)
```
Deploy api, aero-core and web to the demo environment, seed it, point the Bolna agents' custom functions at the demo API, register my passkey
on my phone, run scenarios 1–6 and 10 end to end twice from the Stage (my go-ahead for the calls). /compliance-check after.
```

### Step 18 — Freeze (Wed night)
```
/ship-check. Fix only what blocks the Definition of done. Then freeze: record the agent JSON snapshots, tag the commit `demo-freeze`,
update docs/STATE.md (frozen). From now on: no prompt edits, no deploys, unless something breaks.
```

### Step 19 — Recording support (Thu)
```
Write scripts/clone-clips.ts: render the clone's lines (from docs/DEMO_SCRIPT.md, scenario 3) with Sarvam instant voice cloning from my
consented sample (or ElevenLabs if credits arrived), save to R2 and a local soundboard page (/stage/soundboard) labelled "AI clone of
Saksham's own voice". Add a Stage "recording mode" (hides dev controls, larger type).
```

### Step 20 — README and submission (Fri–Sat)
```
Write README.md for judges (≤ 900 words): one-line pitch, the problem with the sourced numbers in docs/PRODUCT.md, how to try it (number A,
browser link), the architecture picture, how Bolna and Sarvam are used, Halyn Test results (real numbers from the last run), compliance
summary, business, roadmap. Link docs/PASS.md and docs/COMPLIANCE.md. Then /ship-check one last time.
```
