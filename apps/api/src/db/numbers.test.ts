import { HalynError, sha256Hex } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { last4, registeredNumberHash } from './numbers';

const PEPPER = 'p'.repeat(32);

describe('registered numbers', () => {
  it('hash with the pepper so the stored value reveals nothing without it', async () => {
    const hash = await registeredNumberHash(PEPPER, '+919000000003');
    expect(hash).toBe(await sha256Hex(`${PEPPER}+919000000003`));
    expect(hash).not.toBe(await registeredNumberHash('q'.repeat(32), '+919000000003'));
    expect(hash).not.toContain('9000000003');
  });

  it('fail closed on a short pepper or a number that is not E.164', async () => {
    await expect(registeredNumberHash('short', '+919000000003')).rejects.toBeInstanceOf(HalynError);
    await expect(registeredNumberHash(PEPPER, '9000000003')).rejects.toBeInstanceOf(HalynError);
    expect(() => last4('0003')).toThrow(HalynError);
  });

  it('keep only the last 4 digits for display', () => {
    expect(last4('+919000000003')).toBe('0003');
  });
});
