import { describe, expect, it } from 'vitest';
import {
  isReasonCode,
  REASON_CODE_INFO,
  REASON_CODES,
  ReasonCodeSchema,
  type ReasonCategory,
} from './reason-codes';

const CATEGORY_BY_PREFIX: Record<string, ReasonCategory> = {
  P: 'policy',
  S: 'signal',
  T: 'trigger',
  H: 'handoff',
  X: 'pass',
  I: 'identity',
  R: 'readback',
  C: 'confirmation',
  E: 'error',
};

describe('reason codes', () => {
  it('are unique, upper snake case and carry a known prefix', () => {
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
    for (const code of REASON_CODES) expect(code).toMatch(/^[PSTHXIRCE]_[A-Z0-9_]+$/);
  });

  it('each have a description and a category matching their prefix', () => {
    expect(Object.keys(REASON_CODE_INFO).sort()).toEqual([...REASON_CODES].sort());
    for (const code of REASON_CODES) {
      const info = REASON_CODE_INFO[code];
      expect(info.description.length).toBeGreaterThan(10);
      expect(info.category).toBe(CATEGORY_BY_PREFIX[code.charAt(0)]);
    }
  });

  it('validate with the schema and the type guard', () => {
    expect(ReasonCodeSchema.parse('S_COACHING')).toBe('S_COACHING');
    expect(ReasonCodeSchema.safeParse('S_UNKNOWN').success).toBe(false);
    expect(isReasonCode('C_TIMEOUT')).toBe(true);
    expect(isReasonCode('c_timeout')).toBe(false);
    expect(isReasonCode(42)).toBe(false);
  });
});
