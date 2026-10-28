import {
  AeroHomeSchema,
  ApprovalOptionsResponseSchema,
  LedgerListResponseSchema,
  PasskeyRegisterOptionsResponseSchema,
  PendingApprovalSchema,
  SessionResponseSchema,
  StageRunResponseSchema,
  WsMessageSchema,
} from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import {
  aeroHome,
  approvalOptionsBody,
  callLine,
  confirmRequest,
  confirmResolved,
  decisionMessage,
  HASH_A,
  HASH_B,
  ledgerAppend,
  pendingApproval,
  registerOptionsBody,
  sessionBody,
} from './fixtures';

// The web mocks must be bodies the real API handlers could send: the handlers build their responses with these same
// @halyn/shared schemas (apps/api/src/web/*.ts), so a fixture that parses here is accepted by the typed client.

describe('mocks match the API contract', () => {
  it('session, aero home and pending approvals', () => {
    expect(SessionResponseSchema.safeParse(sessionBody('customer')).success).toBe(true);
    expect(SessionResponseSchema.safeParse(sessionBody('console')).success).toBe(true);
    expect(AeroHomeSchema.safeParse(aeroHome()).success).toBe(true);
    expect(PendingApprovalSchema.safeParse(pendingApproval()).success).toBe(true);
  });

  it('WebAuthn options', () => {
    expect(ApprovalOptionsResponseSchema.safeParse(approvalOptionsBody()).success).toBe(true);
    expect(PasskeyRegisterOptionsResponseSchema.safeParse(registerOptionsBody()).success).toBe(true);
  });

  it('every WebSocket message', () => {
    for (const message of [
      decisionMessage('step_up'),
      callLine('agent', 'hello'),
      confirmRequest(),
      confirmResolved('approved'),
      ledgerAppend(1),
      {
        type: 'handoff',
        at: '2026-10-28T10:00:02.000Z',
        handoff_id: 'hnd_1',
        request_id: 'req_01J9ZZZZZZZZZZZZZZZZZZZZZ1',
        reasons: ['S_COACHING'],
        status: 'open',
      },
      {
        type: 'test_progress',
        at: '2026-10-28T10:00:09.000Z',
        test_run_id: 'run_3',
        scenario_id: '3',
        status: 'passed',
        completed: 1,
        total: 1,
      },
    ]) {
      const parsed = WsMessageSchema.safeParse(message);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('stage run and ledger bodies', () => {
    expect(
      StageRunResponseSchema.safeParse({ test_run_id: 'run_3', scenario: '3', mode: 'text' }).success,
    ).toBe(true);
    expect(LedgerListResponseSchema.safeParse({ entries: [], head_hash: null }).success).toBe(true);
    expect(LedgerListResponseSchema.safeParse({ entries: [], head_hash: HASH_B }).success).toBe(true);
    expect(HASH_A).toHaveLength(64);
  });
});
