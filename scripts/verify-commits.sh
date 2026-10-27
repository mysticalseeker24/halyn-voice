#!/usr/bin/env bash
# Verify each commit on its own before a push (docs/HANDOFF.md → Conventions 4).
# Usage (Git Bash, repo root): bash scripts/verify-commits.sh <logdir> <sha>...   e.g. $(git rev-list --reverse origin/main..HEAD)
# Runs in a git worktree at a SHORT path (workerd breaks under long Windows paths), default E:/hvw; override with
# HVW=<dir>. Creates the worktree if missing. Turbo's cache is on, so unchanged packages replay. Prints one line per
# commit; logs go to <logdir>. Known environmental flakes (re-run that commit): the ledger performance test over
# 1,000 ms under CPU contention, and a workerd crash (exit -1073740791 / 0xC0000409) — avoid running two suites at once.
set -u
LOGDIR="$1"; shift
WT="${HVW:-E:/hvw}"
mkdir -p "$LOGDIR"
[ -d "$WT" ] || git worktree add --detach "$WT" HEAD >/dev/null 2>&1 || { echo "cannot create worktree $WT"; exit 1; }
cd "$WT" || exit 1
prev_lock=""
for sha in "$@"; do
  git checkout -q --detach "$sha" || { echo "$sha checkout FAILED"; exit 1; }
  lock=$(git rev-parse HEAD:pnpm-lock.yaml)
  if [ "$lock" != "$prev_lock" ]; then
    pnpm install --frozen-lockfile > "$LOGDIR/$sha.install.log" 2>&1 || { echo "$sha install FAILED"; exit 1; }
    prev_lock="$lock"
  fi
  start=$(date +%s)
  if pnpm verify > "$LOGDIR/$sha.verify.log" 2>&1; then
    echo "$sha $(git log -1 --format=%s) -> PASS ($(( $(date +%s) - start )) s)"
  else
    echo "$sha $(git log -1 --format=%s) -> FAIL ($(( $(date +%s) - start )) s), see $LOGDIR/$sha.verify.log"
    exit 1
  fi
done
echo "ALL PASS"
