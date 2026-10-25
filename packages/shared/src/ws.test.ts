import { describe, expect, it } from 'vitest';
import { HUB_ROLES, WS_MESSAGE_TYPES, WsMessageSchema } from './ws';

const AT = '2026-10-26T10:00:00.000Z';
const REQ = 'req_01J9Z8X7W6V5T4S3R2Q1P0N9M8';
const HASH = 'ab'.repeat(32);

const MESSAGES = [
  {
    type: 'decision',
    at: AT,
    action: 'transfer.new_payee',
    decision: {
      request_id: REQ,
      outcome: 'step_up',
      tier: 4,
      base_tier: 3,
      reasons: ['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER'],
    },
  },
  {
    type: 'confirm_request',
    at: AT,
    request_id: REQ,
    action: 'transfer.new_payee',
    summary: 'Send ₹45,000 to a new payee, account ending 4471',
    amount: { amount_minor: 4500000, currency: 'INR' },
    channels: ['passkey', 'callback'],
    expires_at: '2026-10-26T10:01:00.000Z',
  },
  { type: 'confirm_resolved', at: AT, request_id: REQ, status: 'declined', channel: 'passkey' },
  { type: 'confirm_resolved', at: AT, request_id: REQ, status: 'timeout', channel: null },
  {
    type: 'core_update',
    at: AT,
    customer_id: 'cus_saksham',
    balance: { amount_minor: 18250000, currency: 'INR' },
    activity: {
      reference: 'AERO-FEE-0002',
      summary: 'Late fee waived',
      amount: { amount_minor: 60000, currency: 'INR' },
    },
  },
  {
    type: 'handoff',
    at: AT,
    handoff_id: 'hof_1',
    request_id: REQ,
    reasons: ['S_COACHING', 'H_SPECIALIST'],
    status: 'open',
  },
  {
    type: 'ledger_append',
    at: AT,
    seq: 1,
    entry_type: 'proposed',
    ref_id: REQ,
    hash: HASH,
    prev_hash: '0'.repeat(64),
    chain_ok: true,
  },
  {
    type: 'call_update',
    at: AT,
    run_id: 'run-1',
    agent: 'aero',
    speaker: 'caller',
    text: 'Mera card block kar do',
  },
  {
    type: 'test_progress',
    at: AT,
    test_run_id: 'trun_1',
    scenario_id: '3b',
    status: 'running',
    completed: 3,
    total: 13,
  },
] as const;

describe('Hub WebSocket messages', () => {
  it('cover the types in docs/API.md', () => {
    expect(WS_MESSAGE_TYPES).toEqual([
      'decision',
      'confirm_request',
      'confirm_resolved',
      'core_update',
      'handoff',
      'ledger_append',
      'call_update',
      'test_progress',
    ]);
    expect(new Set(MESSAGES.map((m) => m.type))).toEqual(new Set(WS_MESSAGE_TYPES));
    expect(HUB_ROLES).toEqual(['stage', 'console', 'aero', 'assistant']);
  });

  it.each(MESSAGES)('accepts $type', (message) => {
    expect(WsMessageSchema.parse(message)).toEqual(message);
  });

  it.each([
    ['an unknown type', { type: 'gossip', at: AT }],
    ['a missing timestamp', { ...MESSAGES[2], at: undefined }],
    ['a non-UTC timestamp', { ...MESSAGES[2], at: '2026-10-26T15:30:00+05:30' }],
    ['progress past the total', { ...MESSAGES[8], completed: 14 }],
    ['a ledger seq of 0', { ...MESSAGES[6], seq: 0 }],
    ['an empty transcript line', { ...MESSAGES[7], text: '' }],
  ])('rejects %s', (_, message) => {
    expect(WsMessageSchema.safeParse(message).success).toBe(false);
  });
});
