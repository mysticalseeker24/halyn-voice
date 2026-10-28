# Runbook

## Prerequisites
Node 24 (≥ 22.12; `.node-version`), pnpm 12 (pinned in `package.json`: run `corepack enable pnpm` once, or
`npm i -g pnpm@12`), Wrangler (a dev dependency of each Worker), uv (for the TiDB MCP), a Cloudflare account, a TiDB
Cloud Starter cluster, a Vercel account, the Bolna API key, the Sarvam API key. Claude Code with the Bolna MCP connected.

## First-time setup
1. `cp .env.example .env` and fill it (never commit `.env`). For the Cloudflare and TiDB MCP servers,
   `cp .mcp.example.json .mcp.json` and fill it (git-ignored), then restart Claude Code.
2. `pnpm i`, then `pnpm --filter @halyn/api cf-typegen` and `pnpm --filter @halyn/aero-core cf-typegen` after any
   `wrangler.toml` change.
3. TiDB Cloud Starter cluster → `TIDB_HOST`, `TIDB_PORT`, `TIDB_USERNAME`, `TIDB_PASSWORD` in `.env`. The scripts build the
   connection from these. Databases (ADR-013): `halyn_dev` for wrangler dev, `halyn_test` for the DB test suite,
   `halyn` for the demo. `pnpm db:migrate` creates them on first use.
4. `pnpm --filter @halyn/aero-core exec wrangler d1 create aero-core`, `pnpm --filter @halyn/api exec wrangler kv namespace create halyn-config`,
   (no R2: the account has no payment method, so files live in KV, ADR-023) — put the ids in each `wrangler.toml` (go-ahead
   first: these create Cloudflare resources). Local development and tests need none of them.
5. Signing keys: `pnpm keys:generate halyn-YYYY-MM` writes `scripts/out/keys/<kid>.private.jwk.json` and
   `<kid>.jwks.json` (git-ignored) and prints the `wrangler secret put` commands for `HALYN_SIGNING_KEY` and
   `HALYN_PUBLIC_JWKS` (api) and `HALYN_PUBLIC_JWKS` (aero-core). It never prints the private key. Set `HALYN_KEY_ID`
   to the kid. Then the other secrets: `wrangler secret put BOLNA_API_KEY` (and the rest of `.env.example`) for
   `api` and `aero-core`.
6. `pnpm db:migrate --db halyn_dev` (also `--db halyn_test`, `--db halyn`; default `halyn_dev`) applies `apps/api/drizzle`.
   After a schema change: `pnpm --filter @halyn/api db:generate` writes a new migration (commit it).
   Aero Core's D1: `pnpm seed:core` applies `apps/aero-core/migrations` to the **local** D1 (`.wrangler/state`, what
   `wrangler dev` uses) and runs `apps/aero-core/seed/seed.sql`; re-run it to reset the demo state (card active, fee due,
   EMI on the 5th, balances) before a demo. It never clears `used_grants`. `--write-only` only regenerates the SQL file.
   Deployed D1 (go-ahead first): `pnpm seed:core --remote --yes`. After an Aero Core schema change:
   `pnpm --filter @halyn/aero-core db:generate` (commit the new migration). For `wrangler dev`, Aero Core needs
   `HALYN_PUBLIC_JWKS` in `apps/aero-core/.dev.vars`; `AERO_TENANT_ID` is a var in its `wrangler.toml`.
   Then `pnpm seed --db halyn_dev`: it needs `CUSTOMER_PHONE`, `PHONE_HASH_PEPPER` and `HALYN_SIGNING_KEY` in `.env`
   (`--keys-file scripts/out/keys/<kid>.private.jwk.json` also works). For a dry run without the real number:
   `--test-number +919000000003`. Re-running is safe (upserts).
   For `wrangler dev`, put the API's secrets in `apps/api/.dev.vars` (git-ignored): `HALYN_TOOL_SECRET`, `SESSION_SECRET`,
   `TIDB_DATABASE_URL` (…/halyn_dev), `HALYN_SIGNING_KEY`, `HALYN_PUBLIC_JWKS`, `HALYN_KEY_ID`, `PASS_CODE_PEPPER`,
   `PHONE_HASH_PEPPER`, `BOLNA_API_KEY`, `SARVAM_API_KEY`. `/health` works without any of them.
   Step 7 adds: `BOLNA_CONFIRM_AGENT_ID` (the Confirm agent), `NUMBER_B` (its caller id) and `CUSTOMER_PHONE` (the only
   number the Confirm callback may ring; without the three the step-up uses the passkey alone), `AERO_CORE_URL` for dev
   (production uses the `AERO_CORE` service binding in `wrangler.toml`, so deploy Aero Core first), optionally
   `DEFAULT_REGION` (default `IN`). `WEB_ORIGIN` may list several origins, comma-separated (CORS + passkey origins).
   After pulling Step 7: `pnpm db:migrate` (migration 0001 adds `customers.spoken_name`)
   and `pnpm seed` again on each database (spoken names).
7. `pnpm compile:packs`, then put each compiled pack into KV `CONFIG` under `pack:<tenant>:<region>` — the API reads
   nothing else and denies `E_FAIL_CLOSED` without it (go-ahead first for the remote namespace):
   `pnpm --filter @halyn/api exec wrangler kv key put --binding CONFIG "pack:ten_aero:IN" --path ../../policy-packs/compiled/aero-in.json`
   (and `aero-us.json` as `pack:ten_aero:US`; add `--local` for `wrangler dev`).

## Daily
| Task | Command |
|---|---|
| Dev (API + Aero Core + web) | `pnpm dev` |
| All checks | `pnpm verify` |
| Scenarios (text) | `pnpm test:scenarios` |
| Integration incl. the TiDB suite | `pnpm test:int` (the DB part skips with a warning without TiDB credentials) |
| API locally | `pnpm --filter @halyn/api dev` → http://127.0.0.1:8787/health |
| Aero Core locally | `pnpm seed:core`, then `pnpm --filter @halyn/aero-core dev` → http://127.0.0.1:8788/health |
| Reset the demo bank | `pnpm seed:core` (local) · `pnpm seed:core --remote --yes` (deployed, go-ahead first) |
| E2E | `pnpm test:e2e` |
| Deploy API / Aero Core | `pnpm deploy:api` · `pnpm deploy:core` |
| Deploy web | `pnpm deploy:web` (or Vercel Git integration) |
| Tail logs | `pnpm --filter api exec wrangler tail` |

## Exposing local API to Bolna
Bolna must reach the tool endpoints: use the deployed `dev` Worker (preferred), or `cloudflared tunnel` to localhost.
The IP allowlist still applies.

## Voice session (with go-ahead)
1. Check wallet (`get_user_info`, cents) and plan minutes. 2. Confirm guardrails + `restricted: false`.
3. Run scenarios from the Stage. 4. `/pull-call` for each. 5. `list_violations`; log in `docs/COMPLIANCE.md`.

## Recording the video (Oct 29)
Stage at 1080p dark mode; phone filmed beside the screen; clone clips on the laptop soundboard into the second phone;
two takes per scenario; follow `docs/DEMO_SCRIPT.md`.

## Recovery
| Problem | Fix |
|---|---|
| Agent `restricted: true` | `list_violations`, reword protectively, re-save, re-check |
| Event injection 404 | Call ended; check run id mapping |
| Worker CPU exceeded (Error 1102) | Profile; move work to `waitUntil`; worst case Workers Paid |
| TiDB unreachable | Writes deny by design; check status page; retry |
| Ledger verify fails | Stop; find the first bad `seq`; never "fix" history — investigate |
