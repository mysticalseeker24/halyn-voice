import type { AeroHome, PendingApproval, WsMessage } from '@halyn/shared';

// Shapes follow docs/API.md and packages/shared (the same schemas the API handlers parse their responses with).

export const NOW = '2026-10-28T10:00:00.000Z';
export const REQ_ID = 'req_01J9ZZZZZZZZZZZZZZZZZZZZZ1';
export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
export const GENESIS = '0'.repeat(64);

const b64 = (text: string) => Buffer.from(text).toString('base64url');

/** WebAuthn request options as POST /web/approvals/:id/options returns them (RequestOptionsJsonSchema, strict). */
export const approvalOptionsBody = (credentialId = 'Y3JlZC1pZA') => ({
  options: {
    challenge: b64('authentication-challenge-0123456789'),
    rpId: 'localhost',
    timeout: 60_000,
    userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: credentialId }],
  },
});

/** WebAuthn creation options as POST /web/passkeys/register/options returns them (CreationOptionsJsonSchema, strict). */
export const registerOptionsBody = () => ({
  options: {
    rp: { id: 'localhost', name: 'Aero Bank' },
    user: { id: b64('cus_saksham'), name: 'cus_saksham', displayName: 'Saksham' },
    challenge: b64('registration-challenge-0123456789'),
    pubKeyCredParams: [-8, -7, -257].map((alg) => ({ type: 'public-key', alg })),
    timeout: 300_000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: [],
  },
});

export const sessionBody = (kind: 'customer' | 'console' = 'customer') => ({
  // Not a credential: the mocked API hands out this placeholder.
  token: ['fixture', 'session', 'placeholder'].join('-'),
  tenant_id: 'ten_aero',
  kind,
  customer_id: kind === 'customer' ? 'cus_saksham' : null,
  expires_at: '2099-01-01T00:00:00.000Z',
});

/** Body of POST /web/ws-ticket: an opaque one-time ticket (ADR-021). */
export const wsTicketBody = () => ({
  ticket: 'ten_aero.' + 'fixture-ticket-'.repeat(3),
  expires_at: '2099-01-01T00:00:00.000Z',
});

export const pendingApproval = (overrides: Partial<PendingApproval> = {}): PendingApproval => ({
  request_id: REQ_ID,
  action: 'transfer.new_payee',
  summary: 'Send ₹45,000 to a new payee ending 4471',
  amount: { amount_minor: 4_500_000, currency: 'INR' },
  channels: ['passkey', 'callback'],
  expires_at: '2099-01-01T00:00:00.000Z',
  ...overrides,
});

export const aeroHome = (overrides: Partial<AeroHome> = {}): AeroHome => ({
  customer: { id: 'cus_saksham', name: 'Saksham' },
  accounts: [{ type: 'savings', last4: '4821', balance: { amount_minor: 48_250_075, currency: 'INR' } }],
  activity: [
    {
      id: 'txn_1',
      kind: 'credit',
      category: 'salary',
      amount: { amount_minor: 9_500_000, currency: 'INR' },
      description: 'Salary',
      payee_id: null,
      reference: null,
      created_at: '2026-10-27T09:00:00.000Z',
    },
    {
      id: 'txn_2',
      kind: 'debit',
      category: 'card',
      amount: { amount_minor: 129_900, currency: 'INR' },
      description: 'Groceries',
      payee_id: null,
      reference: null,
      created_at: '2026-10-26T18:30:00.000Z',
    },
  ],
  alerts: [
    {
      id: 'al_1',
      kind: 'blocked',
      title: 'Transfer blocked',
      body: 'A ₹45,000 transfer to a new payee was declined.',
      at: '2026-10-27T11:00:00.000Z',
    },
  ],
  card: { last4: '1234', status: 'active' },
  loan: {
    id: 'loan_1',
    emi: { amount_minor: 1_250_000, currency: 'INR' },
    emi_day: 5,
    outstanding: { amount_minor: 52_000_000, currency: 'INR' },
  },
  passkey_registered: true,
  pending_approvals: [],
  ...overrides,
});

export const decisionMessage = (
  outcome: 'allow' | 'step_up' | 'hold' | 'deny',
  reasons: string[] = ['P_TIER3_STEP_UP'],
): WsMessage =>
  ({
    type: 'decision',
    at: NOW,
    action: 'transfer.new_payee',
    decision: {
      request_id: REQ_ID,
      outcome,
      tier: 3,
      base_tier: 3,
      reasons,
    },
  }) as WsMessage;

export const callLine = (speaker: 'caller' | 'agent' | 'system', text: string): WsMessage => ({
  type: 'call_update',
  at: NOW,
  run_id: 'run_1',
  agent: 'aero',
  speaker,
  text,
});

export const confirmRequest = (): WsMessage => ({
  type: 'confirm_request',
  at: NOW,
  request_id: REQ_ID,
  action: 'transfer.new_payee',
  summary: 'Send ₹45,000 to a new payee ending 4471',
  amount: { amount_minor: 4_500_000, currency: 'INR' },
  channels: ['passkey', 'callback'],
  expires_at: '2099-01-01T00:00:00.000Z',
});

export const confirmResolved = (status: 'approved' | 'declined' | 'timeout'): WsMessage => ({
  type: 'confirm_resolved',
  at: NOW,
  request_id: REQ_ID,
  status,
  channel: status === 'timeout' ? null : 'passkey',
});

export const ledgerAppend = (seq: number, type = 'decided', ok = true): WsMessage => ({
  type: 'ledger_append',
  at: NOW,
  seq,
  entry_type: type,
  ref_id: REQ_ID,
  hash: HASH_B,
  prev_hash: seq === 1 ? GENESIS : HASH_A,
  chain_ok: ok,
});

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
