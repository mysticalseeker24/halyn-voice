---
description: Run every check (lint, typecheck, unit + property, integration, scenarios, build) and report honestly
---

Run `pnpm verify` (or, if a script is missing, run lint, typecheck, `test:unit`, `test:int`, `test:scenarios`, `build`
one by one). Then report:

| Check | Result | Counts / notes |
|---|---|---|

Include coverage for `packages/shared` and `apps/api/src/{gate,pass,grants,ledger}` against the 95% threshold.
If anything fails: show the first failure, its root cause, and the smallest fix. Never call the work done while a check
is red; if a check could not run, say exactly why.
