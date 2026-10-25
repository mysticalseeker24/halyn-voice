import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges classes and lets the later Tailwind utility win', () => {
    expect(cn('px-2 text-sm', false, 'px-4')).toBe('text-sm px-4');
  });
});
