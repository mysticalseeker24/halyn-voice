import {
  type ErrorEnvelope,
  ErrorEnvelopeSchema,
  ProposeActionRequestSchema,
  ProposeActionResponseSchema,
} from '@halyn/shared';
import type { z } from 'zod';

// A typed client for voice platforms other than Bolna: propose an action to Halyn and get back the pending request id.
// The outcome arrives later (an event into the call, or check_decision). Never throws.

export interface HalynClient {
  baseUrl: string;
  /** Sent as `x-halyn-secret`. */
  secret: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export type ProposeActionInput = z.input<typeof ProposeActionRequestSchema>;
export type ProposeActionResponse = z.infer<typeof ProposeActionResponseSchema>;

export type ProposeActionResult =
  | { ok: true; value: ProposeActionResponse }
  | { ok: false; status: number; error: ErrorEnvelope['error'] | null };

export async function proposeAction(
  client: HalynClient,
  request: ProposeActionInput,
): Promise<ProposeActionResult> {
  const parsed = ProposeActionRequestSchema.safeParse(request);
  if (!parsed.success)
    return {
      ok: false,
      status: 0,
      error: { code: 'E_FAIL_CLOSED', message: 'invalid propose_action request' },
    };
  const send = client.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let response: Response;
  try {
    response = await send(`${client.baseUrl.replace(/\/+$/, '')}/tools/propose_action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-halyn-secret': client.secret },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const value = ProposeActionResponseSchema.safeParse(body);
    return value.success
      ? { ok: true, value: value.data }
      : { ok: false, status: response.status, error: null };
  }
  const error = ErrorEnvelopeSchema.safeParse(body);
  return { ok: false, status: response.status, error: error.success ? error.data.error : null };
}
