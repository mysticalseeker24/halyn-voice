import { describe, expect, it } from 'vitest';
import {
  AeroAlertSchema,
  AeroHomeSchema,
  ApprovalDeclineResponseSchema,
  ApprovalOptionsResponseSchema,
  ApprovalVerifyRequestSchema,
  ApprovalVerifyResponseSchema,
  LedgerListResponseSchema,
  PasskeyRegisterOptionsResponseSchema,
  PasskeyRegisterVerifyRequestSchema,
  PasskeyRegisterVerifyResponseSchema,
  PendingApprovalSchema,
  WebauthnOptionsResponseSchema,
} from './api';
import {
  AuthenticationCredentialJsonSchema,
  CreationOptionsJsonSchema,
  RegistrationCredentialJsonSchema,
  RequestOptionsJsonSchema,
} from './webauthn';

const B64 = 'AAECAwQFBgcICQoLDA0ODw';
const AT = '2026-10-28T10:00:00.000Z';

const creation = {
  rp: { id: 'localhost', name: 'Aero Bank' },
  user: { id: 'Y3VzX3Nha3NoYW0', name: 'cus_saksham', displayName: 'Saksham Mishra' },
  challenge: B64,
  pubKeyCredParams: [
    { type: 'public-key', alg: -8 },
    { type: 'public-key', alg: -7 },
    { type: 'public-key', alg: -257 },
  ],
  timeout: 60000,
  attestation: 'none',
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  excludeCredentials: [],
};
const request = {
  challenge: B64,
  rpId: 'localhost',
  timeout: 60000,
  userVerification: 'required',
  allowCredentials: [{ type: 'public-key', id: B64 }],
};

describe('WebAuthn JSON shapes', () => {
  it('accepts creation and request options, and refuses other algorithms or weaker user verification', () => {
    expect(CreationOptionsJsonSchema.safeParse(creation).success).toBe(true);
    expect(
      CreationOptionsJsonSchema.safeParse({
        ...creation,
        pubKeyCredParams: [{ type: 'public-key', alg: -35 }],
      }).success,
    ).toBe(false);
    expect(RequestOptionsJsonSchema.safeParse(request).success).toBe(true);
    expect(RequestOptionsJsonSchema.safeParse({ ...request, userVerification: 'preferred' }).success).toBe(
      false,
    );
  });

  it('reads SimpleWebAuthn browser output, stripping extension results', () => {
    const reg = RegistrationCredentialJsonSchema.parse({
      id: B64,
      rawId: B64,
      type: 'public-key',
      response: {
        clientDataJSON: B64,
        attestationObject: B64,
        transports: ['internal'],
        publicKeyAlgorithm: -7,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    });
    expect('clientExtensionResults' in reg).toBe(false);
    const auth = AuthenticationCredentialJsonSchema.parse({
      id: B64,
      rawId: B64,
      type: 'public-key',
      response: { clientDataJSON: B64, authenticatorData: B64, signature: B64, userHandle: null },
    });
    expect(auth.response.userHandle).toBeNull();
    expect(
      AuthenticationCredentialJsonSchema.safeParse({
        ...auth,
        response: { ...auth.response, signature: '+/=' },
      }).success,
    ).toBe(false);
  });
});

describe('web bodies for the Aero app', () => {
  const pending = {
    request_id: 'req_1',
    action: 'transfer.new_payee',
    summary: 'Send ₹45,000 to a NEW payee, account ending 4471 (AERO0000001)',
    amount: { amount_minor: 4500000, currency: 'INR' },
    channels: ['passkey', 'callback'],
    expires_at: AT,
  };

  it('home: accounts, card, loan, alerts and pending approvals', () => {
    const home = {
      customer: { id: 'cus_saksham', name: 'Saksham Mishra' },
      accounts: [{ type: 'savings', last4: '3094', balance: { amount_minor: 52000000, currency: 'INR' } }],
      activity: [],
      alerts: [
        { id: 'req_2', kind: 'blocked', title: 'Transfer stopped', body: 'Declined on your phone.', at: AT },
      ],
      card: { last4: '8812', status: 'frozen' },
      loan: {
        id: 'loan_personal_1',
        emi: { amount_minor: 1250000, currency: 'INR' },
        emi_day: 5,
        outstanding: { amount_minor: 18750000, currency: 'INR' },
      },
      passkey_registered: true,
      pending_approvals: [pending],
    };
    expect(AeroHomeSchema.safeParse(home).success).toBe(true);
    expect(AeroHomeSchema.safeParse({ ...home, card: null, loan: null }).success).toBe(true);
    expect(AeroHomeSchema.safeParse({ ...home, extra: 1 }).success).toBe(false);
    // Home data is complete: no null last4 or outstanding, and never more than the last 4 digits.
    const [account] = home.accounts;
    expect(AeroHomeSchema.safeParse({ ...home, accounts: [{ ...account, last4: null }] }).success).toBe(
      false,
    );
    expect(AeroHomeSchema.safeParse({ ...home, accounts: [{ ...account, last4: '123456' }] }).success).toBe(
      false,
    );
    expect(AeroHomeSchema.safeParse({ ...home, loan: { ...home.loan, outstanding: null } }).success).toBe(
      false,
    );
    expect(AeroAlertSchema.safeParse({ ...home.alerts[0], kind: 'panic' }).success).toBe(false);
    expect(PendingApprovalSchema.safeParse({ ...pending, channels: [] }).success).toBe(false);
  });

  it('passkey and approval request/response bodies', () => {
    expect(PasskeyRegisterOptionsResponseSchema.safeParse({ options: creation }).success).toBe(true);
    expect(ApprovalOptionsResponseSchema.safeParse({ options: request }).success).toBe(true);
    expect(WebauthnOptionsResponseSchema.safeParse({ options: request }).success).toBe(true);
    expect(WebauthnOptionsResponseSchema.safeParse({ options: creation }).success).toBe(true);
    expect(WebauthnOptionsResponseSchema.safeParse({ options: {} }).success).toBe(false);
    const credential = {
      id: B64,
      rawId: B64,
      type: 'public-key',
      response: { clientDataJSON: B64, authenticatorData: B64, signature: B64 },
    };
    expect(ApprovalVerifyRequestSchema.safeParse({ response: credential }).success).toBe(true);
    expect(ApprovalVerifyRequestSchema.safeParse({}).success).toBe(false);
    expect(
      PasskeyRegisterVerifyRequestSchema.safeParse({
        response: { ...credential, response: { clientDataJSON: B64, attestationObject: B64 } },
      }).success,
    ).toBe(true);
    expect(ApprovalVerifyResponseSchema.safeParse({ ok: true, status: 'approved' }).success).toBe(true);
    expect(ApprovalVerifyResponseSchema.safeParse({ ok: true, status: 'declined' }).success).toBe(false);
    expect(ApprovalDeclineResponseSchema.safeParse({ ok: true, status: 'declined' }).success).toBe(true);
    expect(PasskeyRegisterVerifyResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });

  it('ledger list', () => {
    expect(LedgerListResponseSchema.safeParse({ entries: [], head_hash: null }).success).toBe(true);
    expect(LedgerListResponseSchema.safeParse({ entries: [] }).success).toBe(false);
  });
});
