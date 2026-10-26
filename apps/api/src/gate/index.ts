// The Gate: pure policy decisions (docs/GATE.md). No I/O, no clock reads, no randomness (ESLint purity rule).
export { decide } from './decide';
export { resolveStepUp } from './post-approval';
export { toDecision } from './to-decision';
export * from './types';
