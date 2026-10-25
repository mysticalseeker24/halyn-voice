# Halyn — project memory for Claude Code

@docs/STATE.md

You are building **Halyn, the permission layer for voice agents**, for the Bolna Symphony Buildathon.
Build freeze: **Wed Oct 28, 2026, 23:59 IST**. Submission: **Sat Oct 31, 2026**. Solo builder: Saksham Mishra.

**The one rule:** a voice agent never holds the power to act. It can only *propose* an action. Halyn decides
(allow / step_up / hold / deny) from policy, proof and signals — never from how the caller sounds — and only
Halyn can execute, using a one-time grant bound to the exact action.
Tagline: *Don't trust the voice. Trust the permission.*

---

## 1. Where the truth lives (read only what the task needs)

| Need | File |
|---|---|
| Current status, next step, open issues (auto-loaded above) | `docs/STATE.md` |
| What the product is, threats, parts, business | `docs/PRODUCT.md` |
| The 12 scenarios with exact expected outcomes (**the acceptance spec**) | `docs/SCENARIOS.md` + `tests/scenarios/scenarios.yaml` |
| System design, components, flows, failure behaviour | `docs/ARCHITECTURE.md` |
| Tables and columns | `docs/DATA_MODEL.md` |
| Every endpoint, request/response, auth | `docs/API.md` |
| Policy engine rules and reason codes | `docs/GATE.md` + `policy-packs/*.yaml` |
| Halyn Pass protocol | `docs/PASS.md` |
| Bolna agents, graph nodes, tools, events | `docs/BOLNA.md` + `prompts/` + `agents/` |
| Bolna platform compliance (**hard rules**) | `docs/COMPLIANCE.md` |
| Testing strategy, suites, thresholds | `docs/TESTING.md` |
| Screens and UI rules | `docs/UI.md` |
| Day plan, tiers, cut order | `docs/BUILD_PLAN.md` |
| Run, deploy, record, recover | `docs/RUNBOOK.md` |
| Why we chose X | `docs/DECISIONS.md` (ADR log) |
| What happened each session | `docs/WORKLOG.md` |
| Ordered build prompts | `PROMPTS.md` |

If two documents disagree: `docs/SCENARIOS.md` and the invariants below win; then fix the other document.

---

## 2. Product invariants (never break; every one has tests)

1. **No action without a grant.** The Aero voice agent has no tool that executes anything. Only the Halyn API calls
   Aero Core. Aero Core rejects any write without a valid grant: Ed25519 signature by Halyn, `exp` ≤ 120 s,
   `params_hash` equal to SHA-256 of the canonical JSON of the exact parameters, `jti` never used before.
2. **Fail closed.** Any error, timeout, missing data or unknown state on a write path → `deny` with `E_FAIL_CLOSED`.
   The caller still hears a clear, polite outcome.
3. **Voice is never proof.** Liveness/biometric scores and all other signals may only *raise* the tier. Nothing
   lowers a tier below policy. Proof = registered number (low tiers only), a valid Pass in scope, or an out-of-band
   confirmation (passkey or callback).
4. **Coaching → hold, never step-up.** If the coaching score ≥ threshold, the outcome is `hold` (human specialist),
   because a coached victim would approve a step-up.
5. **Critical actions are never in a Pass** (change registered number/email, close account, new payee, wires).
6. **Ledger is append-only and hash-chained** (`hash = SHA-256(prev_hash ‖ canonical_json(entry))`), appended only
   through the tenant's Durable Object hub so order is strict. `GET /ledger/verify` must detect any edited row.
7. **Idempotent proposals.** `propose_action` is keyed by `(run_id, params_hash)`; LLM retries never create a
   second request or decision.
8. **Tenant isolation.** Every query filters by `tenant_id`. No cross-tenant reads, ever.
9. **Money is integers.** Amounts are integer minor units (paise / cents) + ISO currency. Never floats.
10. **First answer wins** for confirmations; later answers are recorded and ignored. Unanswered after 60 s → deny.

---

## 3. Bolna compliance (hard rules — details in `docs/COMPLIANCE.md`)

- **Never** place a real call, buy/delete a number, relink an inbound number, create/delete an agent, or spend wallet
  credit **without Saksham's explicit go-ahead in this session.** Calls cost real money (wallet units are cents).
- Agent prompts are **protective only** ("help and protect the customer"). No attack scripts, no real bank,
  regulator or brand names in any prompt. Scam-pattern detection lives in code (`apps/api/src/signals`), never in
  a prompt. Never try to get content past Bolna's check (e.g. moving attack lines into call-time variables).
- After every agent create/update: `get_agent` and confirm `restricted: false`. If true → `list_violations`, reword
  protectively, re-save. Report it.
- Every greeting discloses AI + recording. Calling guardrails `call_start_hour: 9, call_end_hour: 21` on every
  outbound agent. **Never** use `bypass_call_guardrails`.
- Outbound calls go only to numbers Saksham owns (his phone, number A). No automated calls to US numbers — the US
  region is browser (Web Call SDK) only.
- **Attacker persona agents are NOT approved yet.** Do not create one until `docs/STATE.md` says Bolna approved.
  Until then, attack scenarios run in text mode (`pnpm test:scenarios`).
- Calls that deliberately sound like fraud (scenarios 3, 4) carry `user_data.purpose = "security_demo"`.
- After any session with real calls: check `list_violations`, log result in `docs/COMPLIANCE.md` → Session log.
- Tool/webhook endpoints accept only Bolna source IPs (`13.203.39.153`, `13.126.9.249`, `13.202.133.53`) **and**
  the `x-halyn-secret` header.

---

## 4. Architecture in one screen

```
Callers ─► Bolna (Vobiz numbers A/B, Web Call SDK)
            ├─ Aero voice agent (graph)  ──custom functions──►  Halyn API (Cloudflare Worker, Hono)
            ├─ Halyn Confirm (outbound)  ◄──event injection──     ├─ Gate (pure)   ├─ Signals   ├─ Pass
            ├─ Assistant agent (outbound)                         ├─ Confirm orch. ├─ Test runner
            └─ Test callers (normal personas)                     └─ Hub Durable Object: WebSockets, alarms, ledger order
Halyn API ─► TiDB Starter (system of record, MySQL)   ─► Aero Core Worker + D1 (mock bank, grant check)
          ─► R2 (clips, exports) · KV (compiled policy packs) · Sarvam (coaching LLM)
Web (Vercel, Next.js): /stage /console /aero /assistant  ◄── REST + WebSocket (hub)
```

Repo map:
```
apps/api          Halyn API Worker (Hono) + Hub Durable Object          → apps/api/CLAUDE.md
apps/aero-core    Mock bank Worker + D1, verifies grants via @halyn/sdk  → apps/aero-core/CLAUDE.md
apps/web          Next.js: stage, console, aero, assistant              → apps/web/CLAUDE.md
packages/shared   Zod schemas, types, reason codes, policy-pack schema, canonical JSON, money
packages/sdk      @halyn/sdk: verifyGrant, proposeAction, verifyLedger (used by Aero Core and tests)
policy-packs      aero-in.yaml, aero-us.yaml (compiled to JSON at build; never parsed at runtime)
prompts, agents   Bolna prompts (source of truth) and exported agent JSON (no secrets)
tests             scenarios.yaml (acceptance), fixtures/bolna (recorded payloads), e2e
scripts           bolna/* (REST helpers), seed, clone-clips, hooks
docs              everything above
```

---

## 5. How to work here (follow every session)

1. **Orient.** STATE.md is loaded. Read the PROMPTS.md step you're on and only the docs it names.
2. **Plan first** for anything over ~50 lines or touching an invariant: list files, tests, risks; then build.
3. **Test first** for `gate`, `pass`, `ledger`, `grants`, `policy`, `money`, `canonical-json`. Elsewhere, tests in
   the same change. No feature is done without tests.
4. **Verify** with `/verify` (lint, typecheck, all test suites, build). Never claim done with a red check.
   If you skipped something, say exactly what and why.
5. **Document** in the same change: update the doc you changed behaviour for, then `/handoff`
   (updates STATE.md + WORKLOG.md, proposes a commit message). New trade-off → `/new-adr`.
6. **Commit** small, conventional (`feat(gate): …`, `test(pass): …`). Never commit failing tests or secrets.
   Only commit/push when Saksham asks.
7. **Delegate** to subagents to keep context lean: `bolna-voice-engineer` (anything on Bolna), `test-engineer`
   (tests and coverage gaps), `code-reviewer` (before every commit), `compliance-reviewer` (prompts/agents/calls),
   `api-builder`, `web-builder`, `call-reviewer`.
8. **Don't guess Bolna.** Use the Bolna MCP `search_docs` / `get_doc`. If the MCP lacks a tool (e.g. graph agents,
   event injection), use the REST helpers in `scripts/bolna/`.
9. **Ambiguity:** check `docs/SCENARIOS.md`; if still unclear, ask Saksham in one sentence and propose a default.

---

## 6. Coding standards

- TypeScript `strict`, `noUncheckedIndexedAccess`. No `any` — use `unknown` + Zod. Zod at every boundary
  (HTTP in, Bolna payloads, DB rows out, env).
- `packages/shared` and `apps/api/src/gate` are **pure**: no I/O, no `Date.now()`, no randomness — inject `clock`
  and `rng`. This keeps them deterministic and property-testable.
- IDs: ULID. Time: UTC ISO strings. Money: `{ amount_minor: number(int), currency: 'INR'|'USD' }`.
- Errors carry reason codes from `packages/shared/src/reason-codes.ts`. Never throw strings.
- Logs: structured JSON; phone and account numbers masked to last 4.
- Workers: 10 ms CPU per request on the free plan. WebCrypto only (Ed25519, SHA-256); no heavy deps; no runtime
  YAML parsing; `nodejs_compat` only if a dependency truly needs it (record in an ADR).
- TiDB is MySQL-compatible: no `RETURNING`, generate IDs in app, use transactions for multi-row writes.
  D1 is SQLite. Drizzle for both.
- UI: follow `docs/UI.md`. Colour always paired with a word (ALLOWED / STEP-UP / HELD / DENIED).

---

## 7. Testing (summary — `docs/TESTING.md` is the rulebook)

| Suite | Command | Must pass before |
|---|---|---|
| Unit (Vitest, Workers pool) | `pnpm test:unit` | every commit |
| Property tests (fast-check) for invariants 1–10 | part of unit | every commit |
| Integration (Miniflare: Worker + DO + D1; TiDB dev branch) | `pnpm test:int` | every commit touching api/aero-core |
| Contract (recorded Bolna payloads in `tests/fixtures/bolna`) | part of int | every commit touching tools/webhooks |
| Scenario acceptance (all 12, text mode, real Gate, no mocks of Halyn) | `pnpm test:scenarios` | every commit, 12/12 |
| E2E (Playwright: stage, approval, pass issue) | `pnpm test:e2e` | before deploy |
| Voice smoke (real Bolna calls) | `/run-scenario` | only with Saksham's go-ahead |

Coverage: ≥ 95% lines and branches for `gate`, `pass`, `ledger`, `grants`, `packages/shared`; ≥ 80% elsewhere.
A bug fix always starts with a failing test that reproduces it.

---

## 8. Key facts

| Item | Value |
|---|---|
| Repo | github.com/mysticalseeker24/halyn-voice |
| Number A (Aero line) | +91 80653 56344 · phone id `9a3b9852-ae7e-4b7c-bab9-f1f0bf4b24d2` · currently linked to the OLD Kavach listener `1ad15c7b-3483-4c9e-a336-e371ce112b98` (to relink in Day-0, with go-ahead) |
| Number B (Confirm, Assistant, test callers) | +91 80653 56379 · phone id `b6875116-e8b9-4174-9c71-08a87cd1dc62` |
| Bolna API | `https://api.bolna.ai` · event injection `POST /v1/call/{run_id}/events` · outbound `POST /call` |
| Bolna LLM | `gpt-5.4-mini`, **temperature must be 1** for GPT-5 family |
| Speech | Sarvam `saaras:v4` STT, `bulbul:v3` TTS (Saksham's own key in Bolna) |
| Markets | India (real calls), US (browser calls only) |
| Agent ids | recorded in `docs/STATE.md` as they are created |

## 9. Gotchas
- Bolna wallet values are in **cents** (500 = $5).
- Event injection works only on **graph agents** and returns 404 once the call has ended.
- Bolna tool calls/webhooks have no HMAC — IP allowlist + shared secret is the only trust.
- Passkeys need HTTPS and `RP_ID` = the web domain; test on the real phone early.
- Do not let the Aero agent read out secrets, OTPs or full account numbers — ever.
