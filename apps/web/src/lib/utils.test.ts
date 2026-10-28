import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges classes and lets the later Tailwind utility win', () => {
    expect(cn('px-2 text-sm', false, 'px-4')).toBe('text-sm px-4');
  });
});

describe('maskLast4', () => {
  it('shows the last 4 only, and a dash when Aero Core has none', async () => {
    const { maskLast4 } = await import('./format');
    expect(maskLast4('4821')).toBe('•••• 4821');
    expect(maskLast4(null)).toBe('—');
    expect(maskLast4(undefined)).toBe('—');
  });
});
