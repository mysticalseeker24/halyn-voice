import { describe, expect, it } from 'vitest';
import { toE164 } from './try-form';

// Ten digits of a +9190000000xx test number, typed the ways judges type it.
const TEN = '90000000' + '77';

describe('/try phone input', () => {
  it('turns what judges type into E.164 (ten Indian digits get +91)', () => {
    expect(toE164(`${TEN.slice(0, 5)} ${TEN.slice(5)}`)).toBe(`+91${TEN}`);
    expect(toE164(`91 ${TEN}`)).toBe(`+91${TEN}`);
    expect(toE164('+1 (415) 000-0000')).toBe('+14150000000');
  });
});
