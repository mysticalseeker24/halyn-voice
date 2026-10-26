# STATE — read at the start of every session, update at the end (`/handoff`)

_Last updated: 2026-10-26 by the Step 3 session (grants, ledger, Pass, SDK)._

## Where we are
- Phase: **Step 3 done locally** (grants, ledger, Pass core, `@halyn/sdk`, keys:generate; api-builder then a
  test-engineer security pass). `pnpm verify` green; grants/ledger/pass/sdk 100% coverage, shared 100/99.7, gate 99.2.
  Not yet committed. Steps 0–2 are on `main`, CI green.
- Tier target: Tier 1 (scenarios 1, 2, 3 end to end) by **Mon Oct 26, night**.
- Freeze: **Wed Oct 28, 23:59 IST**. Video Oct 29. Post Oct 30. Submit Oct 31.

## Waiting on (blockers outside the code)
| Item | Owner | Status |
|---|---|---|
| Bolna reply on attacker personas + fraud-like demo calls | Saksham (Slack) | Sent? → update here |
| Bolna credits ($40 requested) | Bolna | Pending. Wallet 992.5 cents ≈ $9.93 on 2026-10-25 (was ≈ $4.95) |
| ElevenLabs partner credits ($15) | Bolna | Pending. Sarvam instant cloning (beta) is the plan until then |
| Relink number A from old Kavach listener to the Aero agent | Claude Code, with Saksham's go-ahead | Not done |

## Approvals (from Saksham)
- Attacker persona agents on Bolna: **NOT approved yet** — text mode only.
- Spending: any real call / number / agent creation needs a go-ahead in the session.

## Bolna resources
| Resource | Id / value | Notes |
|---|---|---|
| Number A | +918065356344 · `9a3b9852-ae7e-4b7c-bab9-f1f0bf4b24d2` | linked to OLD agent `1ad15c7b-3483-4c9e-a336-e371ce112b98` (Kavach listener, to retire) |
| Number B | +918065356379 · `b6875116-e8b9-4174-9c71-08a87cd1dc62` | unlinked |
| Aero agent (graph, Hindi/English) | — | to create |
| Aero agent (English, US web) | — | to create |
| Halyn Confirm agent | — | to create |
| Assistant agent | — | to create |

## Deployed
| Thing | URL | Status |
|---|---|---|
| API Worker | — | Not deployed. `wrangler deploy --dry-run` bundles. KV `CONFIG` and R2 `halyn-files` not created yet (no ids in `wrangler.toml`) |
| Aero Core Worker | — | Not deployed. D1 `aero-core` not created yet |
| Web (Vercel) | — | Not linked yet |
| TiDB cluster | Starter, `ap-southeast-1` gateway | Reachable over TLS (TiDB v8.5.3 serverless). Only `test`/`sys` + system DBs; `halyn` DB and the `dev` branch not created yet |

## Tooling and MCP (this machine)
| Item | Status |
|---|---|
| Bolna MCP | Connected; account, wallet, numbers A/B and the old listener agent verified 2026-10-25 |
| Cloudflare MCP (`mcp.cloudflare.com`, API token) | In `.mcp.json` (git-ignored); token verified active; `initialize` OK. Loads in a new Claude Code session |
| TiDB MCP (pytidb, `--with "mcp<2"`) | In `.mcp.json`; stdio handshake + `show_databases` OK. Loads in a new Claude Code session |
| Secrets | `.env` filled: Bolna, Sarvam, Cloudflare (+ R2 S3 keys), TiDB. Still empty: `CUSTOMER_PHONE`, `SPECIALIST_NUMBER`, `HALYN_TOOL_SECRET`, signing keys, `PASS_CODE_PEPPER`, `SESSION_SECRET` |
| pnpm | Repo pins pnpm 12.15.0; the global pnpm here is 9.15.2 and ignores the pin. Run `corepack enable pnpm` (or `npm i -g pnpm@12`) once |

## Scenario status (12)
| # | Text mode | Voice | Notes |
|---|---|---|---|
| 1 Freeze card (Hindi) | ☐ | ☐ | |
| 2 Fee waiver | ☐ | ☐ | |
| 3 Clone attack | ☐ | ☐ | hero |
| 4 Coached customer | ☐ | ☐ | hero |
| 5 Assistant in Pass | ☐ | ☐ | |
| 6 Assistant beyond Pass | ☐ | ☐ | |
| 7 Unknown AI, no Pass | ☐ | — | text only |
| 8 Bystander cross-talk | ☐ | — | text only |
| 9 Distress → human | ☐ | — | text only |
| 10 Region US (browser) | ☐ | ☐ | |
| 11 Prompt injection | ☐ | — | text only |
| 12 Velocity split | ☐ | — | text only |

## Next step
Commit + push Step 3 (after Saksham's go-ahead), then **Step 4** in `PROMPTS.md`: 📞 Day-0 checks (`/day0-checks`,
09:00–21:00 IST, wallet check and go-ahead before any call). Steps 5–7 can follow without calls.

## Carry into Steps 5–13 (found in Step 3)
- No Halyn signing keys exist yet: run `pnpm keys:generate halyn-2026-10` before Step 5/8 and load them as secrets
  (the CLI prints the `wrangler secret put` commands; it never prints the private key).
- `verify_pass` handler: pass the call's `tenant_id` to `verifyPassCode` and answer only `{valid:false}` (never the
  internal reason). `/web/ledger/verify`: anchor to the Hub's `ledger_head` and verify incrementally (ADR-012).
- Aero Core (Step 6): call `verifyGrant` with `expectedSub`/`expectedTenant` and act only on `claims.sub`'s accounts;
  jti single use stays in the same D1 batch as the write.

## Carry into Steps 5–7 (found by the Step 2 test-engineer)
- With proof `app_session`, check `caller.app_session_customer_id === customer_id` before calling the Gate.
- The `propose_action` handler must pass the **raw** body's `params` to the Gate / `parseActionParams` (Zod's record
  parse drops an own `__proto__` key; the Gate already re-validates the raw params and fails closed).
- Only call `toDecision(gate, request_id, resolution)` with a resolution when the Gate outcome was `step_up`.
- Velocity (`S_VELOCITY`) applies to every action, as GATE.md says; a balance check right after two transfers is
  tier 1 (still allowed with proof). Revisit only if the Stage's reason list looks confusing.

## Known issues / notes
- Outbound calls only between 9:00 and 21:00 IST (calling guardrails). Plan voice work inside that window.
- Toolchain choices and their risks (tsup unmaintained, eslint-config-next peers on ESLint 10, TS capped at 6.0): ADR-008.
- `test:scenarios` is a placeholder that parses `tests/scenarios/scenarios.yaml` (13 scenarios incl. 3b); the runner is Step 7.
- `keys:generate`, `db:migrate`, `seed` are stubs that exit 1 until Steps 3, 5–6. `compile:packs` is real and runs
  inside `pnpm build` (so CI compiles both packs every run); output in `policy-packs/compiled/` is git-ignored.
- Action params, tiers and Aero Core routes are catalogued in `docs/ACTIONS.md` (checked against code and packs by
  a contract test). Four agent-tier actions have no Aero Core route; an approval of one becomes a handoff (Step 7).
- Pure-module lint rule (no I/O imports, no `Date.now`/`Math.random`/`fetch` in gate, grants, ledger, pass, shared) is
  covered by `tests/tooling/eslint-boundaries.test.ts`. Don't name files `db.ts`/`bolna.ts`/`hub.ts` inside those folders.
