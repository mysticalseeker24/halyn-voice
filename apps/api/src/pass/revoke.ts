import { type Clock, HalynError } from '@halyn/shared';
import { type PassRow, PassRowSchema } from './types';

/** docs/PASS.md "Revoke": effective immediately (every verify checks the row). Idempotent: the first time stands. */
export function revokePass(pass: PassRow, clock: Clock): PassRow {
  const parsed = PassRowSchema.safeParse(pass);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', 'revokePass: malformed Pass row');
  if (parsed.data.status === 'revoked') return parsed.data;
  return { ...parsed.data, status: 'revoked', revoked_at: new Date(clock.nowMs()).toISOString() };
}
