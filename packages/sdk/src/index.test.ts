import { describe, expect, it } from 'vitest';
import { SDK_INFO } from './index';

describe('@halyn/sdk', () => {
  it('speaks the grant format from @halyn/shared (placeholder until Step 3)', () => {
    expect(SDK_INFO).toEqual({
      name: '@halyn/sdk',
      grant_version: 'halyn-grant/0.1',
      grant_max_ttl_seconds: 120,
    });
  });
});
