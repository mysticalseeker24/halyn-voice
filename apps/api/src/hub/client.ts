import type { HubRole, JsonValue, LedgerEntry, WsMessage } from '@halyn/shared';
import type { LedgerHead } from '../ledger';
import type { ConfirmationOutcome, HubAppend, HubDO, StartConfirmation } from './hub-do';
import { type HubResult, toFailure, unwrap } from './result';

/**
 * The Hub's RPC surface with its declared signatures. The runtime's generated stub type maps every value through its
 * serialisation types, which recurses without end on JsonValue; the methods only take and return plain data, so the
 * declared signatures are the contract.
 */
export type HubRpc = Pick<
  HubDO,
  | 'appendLedger'
  | 'ledgerHead'
  | 'ledgerEntries'
  | 'idempotent'
  | 'startConfirmation'
  | 'resolveConfirmation'
  | 'confirmationResult'
  | 'broadcast'
  | 'sockets'
>;

export function hubStub(env: Pick<Env, 'HUB'>, tenant_id: string): HubRpc {
  return env.HUB.getByName(tenant_id) as unknown as HubRpc;
}

/**
 * A tenant's Hub as the Worker uses it. Hub RPC methods return HubResults (never throw across RPC, ADR-014); this
 * turns a failure back into a HalynError on the Worker's side, and wraps `idempotent`'s compute the same way.
 */
export function hubFor(env: Pick<Env, 'HUB'>, tenant_id: string) {
  const stub = hubStub(env, tenant_id);
  return {
    appendLedger: async (input: HubAppend): Promise<LedgerEntry> =>
      unwrap(await stub.appendLedger(tenant_id, input)),
    ledgerHead: async (): Promise<LedgerHead | null> => unwrap(await stub.ledgerHead(tenant_id)),
    ledgerEntries: async (fromSeq?: number, limit?: number): Promise<LedgerEntry[]> =>
      unwrap(await stub.ledgerEntries(tenant_id, fromSeq, limit)),
    idempotent: async <T extends JsonValue>(
      key: string,
      ttlSeconds: number,
      compute: () => Promise<T>,
    ): Promise<T> =>
      unwrap(
        await stub.idempotent<T>(tenant_id, key, ttlSeconds, async (): Promise<HubResult<T>> => {
          try {
            return { ok: true, value: await compute() };
          } catch (err) {
            return toFailure(err);
          }
        }),
      ),
    startConfirmation: async (input: StartConfirmation): Promise<{ deadline: string }> =>
      unwrap(await stub.startConfirmation(tenant_id, input)),
    resolveConfirmation: async (
      input: Parameters<HubRpc['resolveConfirmation']>[1],
    ): Promise<ConfirmationOutcome> => unwrap(await stub.resolveConfirmation(tenant_id, input)),
    confirmationResult: async (request_id: string): Promise<ConfirmationOutcome | null> =>
      unwrap(await stub.confirmationResult(tenant_id, request_id)),
    broadcast: async (message: WsMessage, roles?: HubRole[]): Promise<number> =>
      unwrap(await stub.broadcast(tenant_id, message, roles)),
    sockets: async (): Promise<Record<HubRole, number>> => unwrap(await stub.sockets(tenant_id)),
  };
}
