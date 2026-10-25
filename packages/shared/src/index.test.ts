import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from './index';

describe('@halyn/shared', () => {
  it('exports its package name (placeholder until Step 1)', () => {
    expect(SHARED_PACKAGE).toBe('@halyn/shared');
  });
});
