// @halyn/sdk: what a bank installs. verifyGrant, proposeAction, verifyLedger (PROMPTS.md Step 3).
// Dependency-light; WebCrypto only, so it runs in Workers, Node and browsers.
import { GRANT_MAX_TTL_SECONDS, GRANT_VERSION } from '@halyn/shared';

export const SDK_INFO = {
  name: '@halyn/sdk',
  grant_version: GRANT_VERSION,
  grant_max_ttl_seconds: GRANT_MAX_TTL_SECONDS,
} as const;
