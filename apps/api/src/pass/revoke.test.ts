import { fixedClock, HalynError } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { issuedPass, NOW } from '../../test/fixtures/pass';
import { revokePass } from './index';

describe('revokePass', () => {
  it('revokes at once and is idempotent (the first revocation time stands)', async () => {
    const { row } = await issuedPass();
    const revoked = revokePass(row, fixedClock(NOW + 1000));
    expect(revoked).toEqual({ ...row, status: 'revoked', revoked_at: new Date(NOW + 1000).toISOString() });
    expect(revokePass(revoked, fixedClock(NOW + 9000))).toEqual(revoked);
  });

  it('revokes a locked Pass too', async () => {
    const { row } = await issuedPass({ status: 'locked', failures: 5 });
    expect(revokePass(row, fixedClock(NOW))).toMatchObject({ status: 'revoked', failures: 5 });
  });

  it('fails closed on a malformed row', async () => {
    const { row } = await issuedPass();
    expect(() => revokePass({ ...row, status: 'paused' as never }, fixedClock(NOW))).toThrow(HalynError);
  });
});
