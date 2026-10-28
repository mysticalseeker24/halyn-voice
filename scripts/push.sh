#!/usr/bin/env bash
# One-command push (docs/HANDOFF.md convention 4): secret check → push main as the gh account → print the CI run.
# Run `pnpm verify` first; then `bash scripts/push.sh`. Watch CI with `gh run watch <id> --exit-status`.
set -euo pipefail
node scripts/check-secrets.mjs origin/main
echo "pushing $(git rev-list --count origin/main..HEAD) commit(s)"
# The repo's local config routes github.com to `gh auth git-credential` (no account picker); the flags make sure of it.
GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  push origin main 2>&1 | tail -1
sleep 5
gh run list --limit 1 --json databaseId,status,displayTitle --jq '.[0] | "CI run \(.databaseId): \(.status) — \(.displayTitle)"'
