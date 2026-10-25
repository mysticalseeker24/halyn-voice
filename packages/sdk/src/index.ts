// @halyn/sdk: what a bank installs. verifyGrant, proposeAction, verifyLedger (PROMPTS.md Step 3).
// Dependency-light; WebCrypto only, so it runs in Workers, Node and browsers.
import { SHARED_PACKAGE } from '@halyn/shared';

export const SDK_INFO = { name: '@halyn/sdk', shared: SHARED_PACKAGE } as const;
