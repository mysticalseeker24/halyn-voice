import { z } from 'zod';

/** Every reason code Halyn emits. Single source of truth; docs/GATE.md lists the same set (checked by a test). */
export const REASON_CODES = [
  'P_PROTECTIVE',
  'P_TIER0',
  'P_WITHIN_LIMIT',
  'P_TIER2',
  'P_TIER3_STEP_UP',
  'P_TIER4_HOLD_24H',
  'P_OVER_LIMIT',
  'P_HUMAN_ONLY',
  'P_HUMAN_ONLY_ABOVE_LIMIT',
  'S_UNREGISTERED_NUMBER',
  'S_CALL_BURST',
  'S_UNUSUAL_HOUR',
  'S_LOW_LIVENESS',
  'S_VELOCITY',
  'S_COACHING',
  'T_DISTRESS',
  'H_SPECIALIST',
  'X_PASS_IN_SCOPE',
  'X_PASS_OUT_OF_SCOPE',
  'X_PASS_INVALID',
  'I_NO_PROOF',
  'R_READBACK_NOT_CONFIRMED',
  'C_APPROVED',
  'C_DECLINED',
  'C_TIMEOUT',
  'E_FAIL_CLOSED',
  'E_GRANT_MISSING',
  'E_GRANT_INVALID',
  'E_GRANT_REUSED',
  'E_GRANT_EXPIRED',
  'E_PARAMS_MISMATCH',
  'E_UNAUTHORIZED',
  'E_BAD_REQUEST',
  'E_NOT_FOUND',
] as const;

export const ReasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export type ReasonCategory =
  'policy' | 'signal' | 'trigger' | 'handoff' | 'pass' | 'identity' | 'readback' | 'confirmation' | 'error';

export interface ReasonCodeInfo {
  category: ReasonCategory;
  description: string;
}

export const REASON_CODE_INFO: { readonly [C in ReasonCode]: ReasonCodeInfo } = {
  P_PROTECTIVE: {
    category: 'policy',
    description: 'Protective action (e.g. card freeze): allowed with any proof.',
  },
  P_TIER0: { category: 'policy', description: 'Tier-0 action with proof: allowed.' },
  P_WITHIN_LIMIT: { category: 'policy', description: 'Tier-1 action within its per-period limits: allowed.' },
  P_TIER2: { category: 'policy', description: 'Tier-2 action with proof: allowed.' },
  P_TIER3_STEP_UP: {
    category: 'policy',
    description: 'Tier-3 action: the customer must confirm out of band.',
  },
  P_TIER4_HOLD_24H: {
    category: 'policy',
    description: 'Tier-4 action: confirmation, then a scheduled 24-hour hold.',
  },
  P_OVER_LIMIT: {
    category: 'policy',
    description: 'Over a per-period amount or count limit: at least a step-up.',
  },
  P_HUMAN_ONLY: {
    category: 'policy',
    description: 'Human-only perimeter: a specialist must handle this action.',
  },
  P_HUMAN_ONLY_ABOVE_LIMIT: {
    category: 'policy',
    description: 'Amount above the human-only threshold: specialist handles it.',
  },
  S_UNREGISTERED_NUMBER: {
    category: 'signal',
    description: 'Call comes from neither the registered number nor a Pass number.',
  },
  S_CALL_BURST: { category: 'signal', description: 'Three or more calls in the last hour.' },
  S_UNUSUAL_HOUR: {
    category: 'signal',
    description: "Call at an unusual hour (23:00–06:00 customer's local time).",
  },
  S_LOW_LIVENESS: {
    category: 'signal',
    description: 'Liveness score below 0.3 (advisory; can only raise the tier).',
  },
  S_VELOCITY: { category: 'signal', description: 'Two or more transfers in the last 10 minutes.' },
  S_COACHING: {
    category: 'signal',
    description: 'Caller sounds coached by a third party: hold, never step-up.',
  },
  T_DISTRESS: { category: 'trigger', description: 'Distress phrases: route to a human specialist.' },
  H_SPECIALIST: { category: 'handoff', description: 'Held for a human specialist.' },
  X_PASS_IN_SCOPE: {
    category: 'pass',
    description: 'Valid Halyn Pass covers this action: proof is the Pass.',
  },
  X_PASS_OUT_OF_SCOPE: {
    category: 'pass',
    description: 'Pass does not cover this action: treated as no proof.',
  },
  X_PASS_INVALID: {
    category: 'pass',
    description: 'Pass code invalid, used, expired, from the wrong number, or locked.',
  },
  I_NO_PROOF: { category: 'identity', description: 'No proof of who is asking.' },
  R_READBACK_NOT_CONFIRMED: {
    category: 'readback',
    description: 'Write action without a confirmed read-back: denied.',
  },
  C_APPROVED: { category: 'confirmation', description: 'The customer approved on their own device.' },
  C_DECLINED: { category: 'confirmation', description: 'The customer declined on their own device.' },
  C_TIMEOUT: { category: 'confirmation', description: 'No confirmation within the timeout: denied.' },
  E_FAIL_CLOSED: {
    category: 'error',
    description: 'An error or unknown state on a write path: denied (fail closed).',
  },
  E_GRANT_MISSING: { category: 'error', description: 'Aero Core write without an x-halyn-grant header.' },
  E_GRANT_INVALID: { category: 'error', description: 'Grant signature or claims are invalid.' },
  E_GRANT_REUSED: { category: 'error', description: 'Grant jti was already used.' },
  E_GRANT_EXPIRED: { category: 'error', description: 'Grant has expired.' },
  E_PARAMS_MISMATCH: {
    category: 'error',
    description: 'Request parameters do not match the grant params_hash.',
  },
  E_UNAUTHORIZED: {
    category: 'error',
    description: 'Missing or invalid credentials: Bolna source IP and secret, or a web session token.',
  },
  E_BAD_REQUEST: { category: 'error', description: 'The request body or parameters failed validation.' },
  E_NOT_FOUND: { category: 'error', description: 'No such route or resource for this tenant.' },
};

export function isReasonCode(value: unknown): value is ReasonCode {
  return ReasonCodeSchema.safeParse(value).success;
}
