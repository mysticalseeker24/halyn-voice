import type { ReasonCode } from './reason-codes';

/**
 * Small, flat, public detail an error may carry to its caller as `error.details` (e.g. Aero Core's outcome hint,
 * `CoreOutcomeDetailsSchema`). Never internal detail: that belongs in the cause and the masked log line.
 */
export type ErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export interface HalynErrorOptions extends ErrorOptions {
  details?: ErrorDetails;
}

/** The only error Halyn code throws: it always carries a reason code (CLAUDE.md §6). */
export class HalynError extends Error {
  readonly code: ReasonCode;
  /** Sent to the caller in the error envelope; absent for most errors. */
  readonly details: ErrorDetails | undefined;

  constructor(code: ReasonCode, message: string, options?: HalynErrorOptions) {
    const { details, ...errorOptions } = options ?? {};
    super(message, errorOptions);
    this.name = 'HalynError';
    this.code = code;
    this.details = details;
  }
}

export function isHalynError(value: unknown): value is HalynError {
  return value instanceof HalynError;
}
