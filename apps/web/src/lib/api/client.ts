import {
  AeroHomeSchema,
  AssistantTaskRequestSchema,
  AssistantTaskResponseSchema,
  ApprovalDeclineResponseSchema,
  ApprovalVerifyResponseSchema,
  ErrorEnvelopeSchema,
  IssuePassResponseSchema,
  ListPassesResponseSchema,
  LedgerListResponseSchema,
  LedgerVerifyResponseSchema,
  OkResponseSchema,
  PasskeyRegisterVerifyResponseSchema,
  type PassDraft,
  PassOptionsRequestSchema,
  RevokePassResponseSchema,
  type ReasonCode,
  type Region,
  SessionResponseSchema,
  StageRegionRequestSchema,
  StageRunRequestSchema,
  StageRunResponseSchema,
  WebauthnOptionsResponseSchema,
  type HubRole,
  WsTicketRequestSchema,
  WsTicketResponseSchema,
} from '@halyn/shared';
import type { z } from 'zod';
import { API_URL } from '@/lib/env';

/** Client-side failures that never reach the server get their own codes. */
export type ApiErrorCode = ReasonCode | 'E_NETWORK' | 'E_BAD_RESPONSE';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
  /** The demo access code, sent as `x-demo-code` on sign-in only (never in the bundle: the viewer types it). */
  getDemoCode?: () => string | null;
  fetch?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'DELETE';

/** Typed client: every response is parsed with a Zod schema, every failure becomes an `ApiError`. */
export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? API_URL).replace(/\/+$/, '');

  async function request<S extends z.ZodType>(
    schema: S,
    method: Method,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = { accept: 'application/json', ...extraHeaders };
    const token = options.getToken?.() ?? null;
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('E_NETWORK', 'Could not reach Halyn. Check your connection.', 0);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const envelope = ErrorEnvelopeSchema.safeParse(json);
      if (envelope.success)
        throw new ApiError(envelope.data.error.code, envelope.data.error.message, response.status);
      throw new ApiError(
        'E_BAD_RESPONSE',
        `Unexpected error response (${response.status}).`,
        response.status,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new ApiError('E_BAD_RESPONSE', 'Halyn sent an unexpected response.', response.status);
    return parsed.data;
  }

  const id = (value: string) => encodeURIComponent(value);
  const demoHeaders = (): Record<string, string> => {
    const code = options.getDemoCode?.() ?? null;
    return code ? { 'x-demo-code': code } : {};
  };

  return {
    createCustomerSession: (customerId: string) =>
      request(
        SessionResponseSchema,
        'POST',
        '/web/session',
        { kind: 'customer', customer_id: customerId },
        demoHeaders(),
      ),
    createConsoleSession: () =>
      request(SessionResponseSchema, 'POST', '/web/session', { kind: 'console' }, demoHeaders()),

    aeroHome: () => request(AeroHomeSchema, 'GET', '/web/aero/home'),

    /** One-time, 30 s ticket for `GET /ws` (ADR-021): the session token never goes into a URL. */
    wsTicket: (role: HubRole) =>
      request(WsTicketResponseSchema, 'POST', '/web/ws-ticket', WsTicketRequestSchema.parse({ role })),

    approvalOptions: (requestId: string) =>
      request(WebauthnOptionsResponseSchema, 'POST', `/web/approvals/${id(requestId)}/options`, {}),
    approvalVerify: (requestId: string, response: unknown) =>
      request(ApprovalVerifyResponseSchema, 'POST', `/web/approvals/${id(requestId)}/verify`, { response }),
    approvalDecline: (requestId: string) =>
      request(ApprovalDeclineResponseSchema, 'POST', `/web/approvals/${id(requestId)}/decline`, {}),

    passkeyRegisterOptions: () =>
      request(WebauthnOptionsResponseSchema, 'POST', '/web/passkeys/register/options', {}),
    passkeyRegisterVerify: (response: unknown) =>
      request(PasskeyRegisterVerifyResponseSchema, 'POST', '/web/passkeys/register/verify', { response }),

    /** Halyn Pass (docs/PASS.md): consent options bound to the draft, then issue with the passkey assertion. */
    passOptions: (draft: PassDraft) =>
      request(
        WebauthnOptionsResponseSchema,
        'POST',
        '/web/passes/options',
        PassOptionsRequestSchema.parse(draft),
      ),
    issuePass: (draft: PassDraft, response: unknown) =>
      request(IssuePassResponseSchema, 'POST', '/web/passes', { ...draft, response }),
    listPasses: () => request(ListPassesResponseSchema, 'GET', '/web/passes'),
    revokePass: (passId: string) => request(RevokePassResponseSchema, 'DELETE', `/web/passes/${id(passId)}`),
    /** The Assistant calls Aero (number B → A) on this Pass. */
    assistantTask: (task: string, passId: string) =>
      request(
        AssistantTaskResponseSchema,
        'POST',
        '/web/assistant/tasks',
        AssistantTaskRequestSchema.parse({ task, pass_id: passId }),
      ),

    stageRun: (scenario: string, mode: 'text' | 'voice' = 'text') =>
      request(
        StageRunResponseSchema,
        'POST',
        `/web/stage/run/${id(scenario)}`,
        StageRunRequestSchema.parse({ mode }),
      ),
    stageRegion: (region: Region) =>
      request(OkResponseSchema, 'POST', '/web/stage/region', StageRegionRequestSchema.parse({ region })),

    ledger: (limit = 50) => request(LedgerListResponseSchema, 'GET', `/web/ledger?limit=${limit}`),
    ledgerVerify: () => request(LedgerVerifyResponseSchema, 'GET', '/web/ledger/verify'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
