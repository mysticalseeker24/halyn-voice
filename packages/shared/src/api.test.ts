import { describe, expect, it } from 'vitest';
import {
  CheckDecisionRequestSchema,
  CheckDecisionResponseSchema,
  ConfirmResultRequestSchema,
  errorEnvelope,
  ErrorEnvelopeSchema,
  GetPassCodeRequestSchema,
  GetPassCodeResponseSchema,
  HandoffResolveRequestSchema,
  HandoffResolveResponseSchema,
  IssuePassRequestSchema,
  IssuePassResponseSchema,
  LedgerVerifyResponseSchema,
  ListPassesResponseSchema,
  LookupCustomerRequestSchema,
  LookupCustomerResponseSchema,
  OkResponseSchema,
  ProposeActionRequestSchema,
  ProposeActionResponseSchema,
  SessionRequestSchema,
  SessionResponseSchema,
  StageRegionRequestSchema,
  StageRunRequestSchema,
  StageRunResponseSchema,
  VerifyPassRequestSchema,
  VerifyPassResponseSchema,
} from './api';

const RUN = 'b1f6c8e2-7d3a-4c1e-9f00-123456789abc';
const REQ = 'req_01J9Z8X7W6V5T4S3R2Q1P0N9M8';
const TOKEN = 'eyJhbGciOiJFZERTQSJ9.eyJ2IjoiaGFseW4tcGFzcy8wLjEifQ.c2lnbmF0dXJl';
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe('Bolna tool: lookup_customer', () => {
  it('validates request and response', () => {
    expect(ok(LookupCustomerRequestSchema, { run_id: RUN, from_number: '+919000000001' })).toBe(true);
    expect(
      ok(LookupCustomerRequestSchema, { run_id: RUN, from_number: '+919000000001', claimed_name: 'Saksham' }),
    ).toBe(true);
    expect(ok(LookupCustomerRequestSchema, { run_id: RUN })).toBe(false);
    expect(
      ok(LookupCustomerResponseSchema, {
        customer_found: true,
        customer_name: 'Saksham',
        region: 'IN',
        registered: true,
        language: 'hi',
      }),
    ).toBe(true);
    expect(ok(LookupCustomerResponseSchema, { customer_found: false, registered: false })).toBe(true);
  });
});

describe('Bolna tool: verify_pass', () => {
  it('normalises the spoken code', () => {
    expect(
      VerifyPassRequestSchema.parse({ run_id: RUN, from_number: '+918065356379', code: '4 7 2 9 1 5' }).code,
    ).toBe('472915');
  });
  it('never echoes the code back', () => {
    expect(
      ok(VerifyPassResponseSchema, {
        valid: true,
        assistant_name: "Saksham's Assistant",
        scopes_summary: 'statement, card freeze, one EMI move',
      }),
    ).toBe(true);
    expect(ok(VerifyPassResponseSchema, { valid: false, code: '472915' })).toBe(false);
  });
});

describe('Bolna tool: propose_action', () => {
  const request = {
    run_id: RUN,
    from_number: '+919000000001',
    channel: 'phone',
    action: 'transfer.new_payee',
    params: {
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
    },
    readback_confirmed: true,
    caller_quotes: ['Send it to my new payee'],
  };

  it('accepts the envelope; per-action params are checked separately (bad params → deny, not 400)', () => {
    expect(ProposeActionRequestSchema.parse(request).action).toBe('transfer.new_payee');
    expect(
      ok(ProposeActionRequestSchema, { ...request, action: 'card.melt', params: { anything: true } }),
    ).toBe(true);
  });

  it('defaults caller quotes and keeps only the last 5, each cut to 300 chars', () => {
    const { caller_quotes: _, ...withoutQuotes } = request;
    expect(ProposeActionRequestSchema.parse(withoutQuotes).caller_quotes).toEqual([]);
    const quotes = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'x'.repeat(400)];
    const parsed = ProposeActionRequestSchema.parse({ ...request, caller_quotes: quotes });
    expect(parsed.caller_quotes).toHaveLength(5);
    expect(parsed.caller_quotes[0]).toBe('q3');
    expect(parsed.caller_quotes[4]).toHaveLength(300);
  });

  it.each([
    ['an unknown channel', { channel: 'sms' }],
    ['a missing readback flag', { readback_confirmed: undefined }],
    ['params that are not an object', { params: 'transfer' }],
    ['a malformed caller number', { from_number: '9000000001' }],
    ['too many quotes', { caller_quotes: Array.from({ length: 21 }, () => 'q') }],
  ])('rejects %s', (_, change) => {
    expect(ok(ProposeActionRequestSchema, { ...request, ...change })).toBe(false);
  });

  it('answers pending with a request id', () => {
    expect(ok(ProposeActionResponseSchema, { request_id: REQ, status: 'pending' })).toBe(true);
    expect(ok(ProposeActionResponseSchema, { request_id: REQ, status: 'allow' })).toBe(false);
  });
});

describe('Bolna tools: get_pass_code, confirm_result, check_decision', () => {
  it('get_pass_code takes a compact JWS and returns 6 digits', () => {
    expect(ok(GetPassCodeRequestSchema, { run_id: RUN, pass_token: TOKEN })).toBe(true);
    expect(ok(GetPassCodeRequestSchema, { run_id: RUN, pass_token: 'not-a-jws' })).toBe(false);
    expect(ok(GetPassCodeResponseSchema, { code: '472915' })).toBe(true);
    expect(ok(GetPassCodeResponseSchema, { code: '4729' })).toBe(false);
  });

  it('confirm_result takes approve/decline by speech or keypad', () => {
    expect(
      ok(ConfirmResultRequestSchema, { run_id: RUN, request_id: REQ, answer: 'decline', method: 'keypad' }),
    ).toBe(true);
    expect(
      ok(ConfirmResultRequestSchema, { run_id: RUN, request_id: REQ, answer: 'maybe', method: 'speech' }),
    ).toBe(false);
    expect(ok(OkResponseSchema, { ok: true })).toBe(true);
  });

  it('check_decision returns the pending state or the event the call would have received', () => {
    expect(ok(CheckDecisionRequestSchema, { run_id: RUN, request_id: REQ })).toBe(true);
    expect(ok(CheckDecisionResponseSchema, { request_id: REQ, status: 'pending' })).toBe(true);
    expect(
      ok(CheckDecisionResponseSchema, {
        request_id: REQ,
        status: 'decided',
        event: { event: 'deny', properties: { request_id: REQ, reason: 'I_NO_PROOF' } },
      }),
    ).toBe(true);
    expect(ok(CheckDecisionResponseSchema, { request_id: REQ, status: 'decided' })).toBe(false);
    expect(
      ok(CheckDecisionResponseSchema, {
        request_id: REQ,
        status: 'pending',
        event: { event: 'allow', properties: { request_id: REQ } },
      }),
    ).toBe(false);
  });
});

describe('error envelope', () => {
  it('carries a reason code', () => {
    expect(errorEnvelope('E_FAIL_CLOSED', 'Something went wrong')).toEqual({
      error: { code: 'E_FAIL_CLOSED', message: 'Something went wrong' },
    });
    expect(ok(ErrorEnvelopeSchema, { error: { code: 'NOT_A_CODE', message: 'x' } })).toBe(false);
  });
});

describe('web', () => {
  it('session: customers name themselves, console users do not', () => {
    expect(ok(SessionRequestSchema, { kind: 'customer', customer_id: 'cus_saksham' })).toBe(true);
    expect(ok(SessionRequestSchema, { kind: 'console' })).toBe(true);
    expect(ok(SessionRequestSchema, { kind: 'customer' })).toBe(false);
    expect(ok(SessionRequestSchema, { kind: 'console', customer_id: 'cus_saksham' })).toBe(false);
    expect(
      ok(SessionResponseSchema, {
        token: 'opaque-session-token',
        tenant_id: 'ten_aero',
        kind: 'customer',
        customer_id: 'cus_saksham',
        expires_at: '2026-10-26T12:00:00.000Z',
      }),
    ).toBe(true);
  });

  const issue = {
    assistant: { name: "Saksham's Assistant", numbers: ['+918065356379'] },
    scopes: [{ action: 'statement.view' }, { action: 'emi.move_date', max_uses: 1 }],
    expires_in_days: 7,
    webauthn: { id: 'cred', response: {} },
  };
  const summary = {
    id: 'pass_demo',
    assistant_name: "Saksham's Assistant",
    assistant_numbers: ['+918065356379'],
    scopes: issue.scopes,
    status: 'active',
    issued_at: '2026-10-26T10:00:00.000Z',
    expires_at: '2026-11-02T10:00:00.000Z',
  };

  it('passes: issue, list', () => {
    expect(ok(IssuePassRequestSchema, issue)).toBe(true);
    expect(ok(IssuePassRequestSchema, { ...issue, scopes: [{ action: 'transfer.new_payee' }] })).toBe(false);
    expect(ok(IssuePassRequestSchema, { ...issue, expires_in_days: 31 })).toBe(false);
    expect(ok(IssuePassResponseSchema, { pass: summary, token: TOKEN })).toBe(true);
    expect(
      ok(ListPassesResponseSchema, { passes: [summary, { ...summary, id: 'pass_old', status: 'revoked' }] }),
    ).toBe(true);
  });

  it('stage controls', () => {
    expect(StageRunRequestSchema.parse({})).toEqual({ mode: 'text' });
    expect(
      ok(StageRunResponseSchema, {
        test_run_id: 'trun_01J9Z8X7W6V5T4S3R2Q1P0N9M8',
        scenario: '3b',
        mode: 'text',
      }),
    ).toBe(true);
    expect(ok(StageRunResponseSchema, { test_run_id: 'trun_1', scenario: '13', mode: 'text' })).toBe(false);
    expect(ok(StageRegionRequestSchema, { region: 'US' })).toBe(true);
  });

  it('ledger verify reports the head or the first bad seq', () => {
    expect(ok(LedgerVerifyResponseSchema, { ok: true, entries: 12, head_hash: 'ab'.repeat(32) })).toBe(true);
    expect(ok(LedgerVerifyResponseSchema, { ok: true, entries: 0, head_hash: null })).toBe(true);
    expect(ok(LedgerVerifyResponseSchema, { ok: false, entries: 12, first_bad_seq: 7 })).toBe(true);
    expect(ok(LedgerVerifyResponseSchema, { ok: false, entries: 12 })).toBe(false);
  });

  it('handoff resolve: release or block', () => {
    expect(
      ok(HandoffResolveRequestSchema, { action: 'block', note: 'Caller coached; customer called back.' }),
    ).toBe(true);
    expect(ok(HandoffResolveRequestSchema, { action: 'approve' })).toBe(false);
    expect(ok(HandoffResolveResponseSchema, { ok: true, status: 'blocked' })).toBe(true);
    expect(ok(HandoffResolveResponseSchema, { ok: true, status: 'open' })).toBe(false);
  });
});
