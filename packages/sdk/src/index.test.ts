import { describe, expect, it } from 'vitest';
import { SDK_INFO } from './index';

describe('@halyn/sdk', () => {
  it('builds on @halyn/shared (placeholder until Step 3)', () => {
    expect(SDK_INFO).toEqual({ name: '@halyn/sdk', shared: '@halyn/shared' });
  });
});
