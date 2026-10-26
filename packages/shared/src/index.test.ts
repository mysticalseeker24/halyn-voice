import { describe, expect, it } from 'vitest';
import * as shared from './index';

describe('@halyn/shared public surface', () => {
  it.each([
    'HalynError',
    'fixedClock',
    'REASON_CODES',
    'UlidSchema',
    'REGION_CURRENCY',
    'formatMoney',
    'canonicalJson',
    'ACTION_IDS',
    'PolicyPackSchema',
    'compilePolicyPack',
    'PassClaimsSchema',
    'GrantClaimsSchema',
    'DecisionSchema',
    'ProposeActionRequestSchema',
    'OutcomeEventSchema',
    'WsMessageSchema',
    'newUlid',
    'newId',
    'paramsHash',
    'signCompactJws',
    'verifyCompactJws',
    'importSigningKey',
    'importVerifyKeys',
    'maskDeep',
    'verifyLedgerChain',
    'ledgerHash',
  ])('exports %s', (name) => {
    expect(shared).toHaveProperty(name);
  });
});
