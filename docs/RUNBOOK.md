# Runbook

## Prerequisites
Node 20+, pnpm 9+, Wrangler (via `pnpm dlx wrangler`), a Cloudflare account, a TiDB Cloud Starter cluster, a Vercel
account, the Bolna API key, the Sarvam API key. Claude Code with the Bolna MCP connected.

## First-time setup
1. `cp .env.example .env` and fill it (never commit `.env`).
2. `pnpm i`
3. Create TiDB cluster (MySQL-compatible Starter) → put the HTTP connection URL in `TIDB_DATABASE_URL`; create a `dev` branch.
4. `pnpm --filter api exec wrangler d1 create aero-core` (and `aero-core-dev`), `wrangler kv namespace create halyn-config`, `wrangler r2 bucket create halyn-files` — put ids in `wrangler.toml`.
5. Secrets: `wrangler secret put BOLNA_API_KEY` (and the others listed in `.env.example`) for `api` and `aero-core`.
6. `pnpm db:migrate` (TiDB + D1) · `pnpm seed`
7. `pnpm compile:packs`

## Daily
| Task | Command |
|---|---|
| Dev (API + Aero Core + web) | `pnpm dev` |
| All checks | `pnpm verify` |
| Scenarios (text) | `pnpm test:scenarios` |
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
