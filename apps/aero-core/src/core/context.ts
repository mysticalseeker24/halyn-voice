import type { CoreActionId } from '@halyn/shared';
import type { CoreDb } from '../db/client';

/** Everything a handler needs: the verified grant's identity, the database, and the request's time and id source. */
export interface ExecContext {
  db: CoreDb;
  /** The grant's tenant (equal to AERO_TENANT_ID: checked by verifyGrant). */
  tenant: string;
  /** The grant's `sub`: the only customer whose rows this request may touch. */
  customer: string;
  jti: string;
  requestId: string;
  action: CoreActionId;
  /** The request's time, UTC ISO-8601. */
  now: string;
  /** `<prefix>_<ULID>` from the injected clock and rng. */
  newId(prefix: string): string;
}

/** The speakable reference for a write: `AERO-` + the last 6 characters of the grant's jti (Crockford base32). */
export function referenceFor(jti: string): string {
  return `AERO-${jti.slice(-6)}`;
}
