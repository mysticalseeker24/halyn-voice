# STATE — read at the start of every session, update at the end (`/handoff`)

_Last updated: 2026-10-26 00:10 IST by the Step 0 session (scaffold)._

## Where we are
- Phase: **Step 0 done** (monorepo scaffold, no business logic). `pnpm verify` green locally; `pnpm test:e2e` 5/5.
  Not yet committed or pushed, so CI has not run on it.
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
Commit and push Step 0 (5–8 commits per push), confirm CI is green, then **Step 1** in `PROMPTS.md` (packages/shared, test-first).

## Known issues / notes
- Outbound calls only between 9:00 and 21:00 IST (calling guardrails). Plan voice work inside that window.
- Toolchain choices and their risks (tsup unmaintained, eslint-config-next peers on ESLint 10, TS capped at 6.0): ADR-008.
- `test:scenarios` is a placeholder that parses `tests/scenarios/scenarios.yaml` (13 scenarios incl. 3b); the runner is Step 7.
- `compile:packs`, `keys:generate`, `db:migrate`, `seed` are stubs that exit 1 until Steps 1, 3, 5–6.
- Pure-module lint rule (no I/O imports, no `Date.now`/`Math.random`/`fetch` in gate, grants, ledger, pass, shared) is
  covered by `tests/tooling/eslint-boundaries.test.ts`. Don't name files `db.ts`/`bolna.ts`/`hub.ts` inside those folders.
