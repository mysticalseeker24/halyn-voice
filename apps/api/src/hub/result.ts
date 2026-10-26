import { HalynError, type ReasonCode } from '@halyn/shared';

// Errors never cross the Hub's RPC boundary as exceptions (ADR-014): the runtime reports every rejected RPC as an
// uncaught exception in the callee, and the error class does not survive serialisation. Hub methods return a
// HubResult instead, and the Worker-side client (client.ts) turns a failure back into a HalynError.

export type HubFailure = { ok: false; code: ReasonCode; message: string };
export type HubResult<T> = { ok: true; value: T } | HubFailure;

export function toFailure(err: unknown): HubFailure {
  return err instanceof HalynError
    ? { ok: false, code: err.code, message: err.message }
    : { ok: false, code: 'E_FAIL_CLOSED', message: 'hub: unexpected error' };
}

export function unwrap<T>(result: HubResult<T>): T {
  if (result.ok) return result.value;
  throw new HalynError(result.code, result.message);
}
