import type { ReasonCode } from './reason-codes';

/** The only error Halyn code throws: it always carries a reason code (CLAUDE.md §6). */
export class HalynError extends Error {
  readonly code: ReasonCode;

  constructor(code: ReasonCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HalynError';
    this.code = code;
  }
}

export function isHalynError(value: unknown): value is HalynError {
  return value instanceof HalynError;
}
