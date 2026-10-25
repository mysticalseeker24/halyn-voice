import { describe, expect, it } from 'vitest';
import { LanguageSchema, REGION_CURRENCY, RegionSchema } from './region';

describe('regions', () => {
  it('pair each market with its currency', () => {
    expect(REGION_CURRENCY).toEqual({ IN: 'INR', US: 'USD' });
    expect(RegionSchema.options).toEqual(['IN', 'US']);
  });
  it('know the call languages', () => {
    expect(LanguageSchema.parse('hi')).toBe('hi');
    expect(LanguageSchema.safeParse('fr').success).toBe(false);
  });
});
