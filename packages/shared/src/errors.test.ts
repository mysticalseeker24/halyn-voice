import { describe, expect, it } from 'vitest';
import { HalynError, isHalynError } from './errors';

describe('HalynError', () => {
  it('carries a reason code and keeps the Error contract', () => {
    const cause = new Error('db down');
    const err = new HalynError('E_FAIL_CLOSED', 'TiDB unreachable', { cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HalynError');
    expect(err.code).toBe('E_FAIL_CLOSED');
    expect(err.message).toBe('TiDB unreachable');
    expect(err.cause).toBe(cause);
    expect(err.details).toBeUndefined();
  });

  it('may carry public details for the caller, kept apart from the cause', () => {
    const cause = new Error('D1 refused');
    const details = { outcome: 'executed', reference: 'AERO-X3Z5B7' };
    const err = new HalynError('E_GRANT_REUSED', 'The grant has already been used', { cause, details });
    expect(err.details).toEqual(details);
    expect(err.cause).toBe(cause);
    const plain = new HalynError('E_FAIL_CLOSED', 'x', { details: { outcome: 'unknown' } });
    expect(plain.details).toEqual({ outcome: 'unknown' });
    expect('cause' in plain).toBe(false);
  });

  it('is recognised by isHalynError and nothing else is', () => {
    expect(isHalynError(new HalynError('I_NO_PROOF', 'x'))).toBe(true);
    expect(isHalynError(new Error('x'))).toBe(false);
    expect(isHalynError('E_FAIL_CLOSED')).toBe(false);
  });
});
