import type { HubRole, JsonValue, LedgerEntry, Region, WsMessage } from '@halyn/shared';
import type { LedgerHead } from '../ledger';
import type { PassRow } from '../pass';
import type { ExecutionResult, IdentifyInput, ProposeInput, ProposeOutcome } from './flows';
import type { ConfirmationOutcome, CustomerView, HubAppend, HubDO, StartConfirmation } from './hub-do';
import { type HubResult, toFailure, unwrap } from './result';
import type { CallState, CredentialRecord, DirectoryCustomer, RequestRecord } from './types';

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
  | 'warm'
  | 'identifyCaller'
  | 'verifyPassCode'
  | 'mintPassCode'
  | 'propose'
  | 'requestState'
  | 'runIdForCallSid'
  | 'recordExecution'
  | 'beginExecution'
  | 'noteGrant'
  | 'finishExecution'
  | 'attachCallback'
  | 'customerView'
  | 'putChallenge'
  | 'takeChallenge'
  | 'passkeys'
  | 'savePasskey'
  | 'customerPasses'
  | 'issuePass'
  | 'revokePass'
  | 'attachAssistantCall'
  | 'assistantCallPass'
  | 'setStageRegion'
  | 'stageRegion'
  | 'issueWsTicket'
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

    // ADR-016: the call-time read model and the proposal lane.
    warm: async (): Promise<number> => unwrap(await stub.warm(tenant_id)),
    identifyCaller: async (
      input: IdentifyInput,
    ): Promise<{ call: CallState; customer: DirectoryCustomer | null }> =>
      unwrap(await stub.identifyCaller(tenant_id, input)),
    verifyPassCode: async (input: Parameters<HubRpc['verifyPassCode']>[1]) =>
      unwrap(await stub.verifyPassCode(tenant_id, input)),
    mintPassCode: async (input: { pass_id: string; calling_number: string }) =>
      unwrap(await stub.mintPassCode(tenant_id, input)),
    propose: async (input: ProposeInput): Promise<ProposeOutcome> =>
      unwrap(await stub.propose(tenant_id, input)),
    requestState: async (request_id: string): Promise<RequestRecord | null> =>
      unwrap(await stub.requestState(tenant_id, request_id)),
    runIdForCallSid: async (call_sid: string): Promise<string | null> =>
      unwrap(await stub.runIdForCallSid(tenant_id, call_sid)),
    recordExecution: async (input: Parameters<HubRpc['recordExecution']>[1]): Promise<boolean> =>
      unwrap(await stub.recordExecution(tenant_id, input)),
    beginExecution: async (request_id: string): Promise<RequestRecord | null> =>
      unwrap(await stub.beginExecution(tenant_id, request_id)),
    noteGrant: async (request_id: string, grant: Parameters<HubRpc['noteGrant']>[2]): Promise<true> =>
      unwrap(await stub.noteGrant(tenant_id, request_id, grant)),
    /** Null: the request was already final (the Hub's sweep finished it first); nothing changed (ADR-020). */
    finishExecution: async (request_id: string, result: ExecutionResult): Promise<RequestRecord | null> =>
      unwrap(await stub.finishExecution(tenant_id, request_id, result)),
    attachCallback: async (request_id: string, execution_id: string | null): Promise<true> =>
      unwrap(await stub.attachCallback(tenant_id, request_id, execution_id)),
    customerView: async (customer_id: string): Promise<CustomerView> =>
      unwrap(await stub.customerView(tenant_id, customer_id)),
    putChallenge: async (input: Parameters<HubRpc['putChallenge']>[1]): Promise<true> =>
      unwrap(await stub.putChallenge(tenant_id, input)),
    takeChallenge: async (input: Parameters<HubRpc['takeChallenge']>[1]): Promise<boolean> =>
      unwrap(await stub.takeChallenge(tenant_id, input)),
    passkeys: async (customer_id: string): Promise<CredentialRecord[]> =>
      unwrap(await stub.passkeys(tenant_id, customer_id)),
    savePasskey: async (credential: CredentialRecord): Promise<true> =>
      unwrap(await stub.savePasskey(tenant_id, credential)),
    customerPasses: async (customer_id: string): Promise<PassRow[]> =>
      unwrap(await stub.customerPasses(tenant_id, customer_id)),
    issuePass: async (row: PassRow): Promise<PassRow> => unwrap(await stub.issuePass(tenant_id, row)),
    revokePass: async (customer_id: string, pass_id: string): Promise<PassRow | null> =>
      unwrap(await stub.revokePass(tenant_id, customer_id, pass_id)),
    attachAssistantCall: async (run_id: string, pass_id: string): Promise<true> =>
      unwrap(await stub.attachAssistantCall(tenant_id, run_id, pass_id)),
    assistantCallPass: async (run_id: string): Promise<string | null> =>
      unwrap(await stub.assistantCallPass(tenant_id, run_id)),
    setStageRegion: async (region: Region): Promise<Region> =>
      unwrap(await stub.setStageRegion(tenant_id, region)),
    stageRegion: async (): Promise<Region> => unwrap(await stub.stageRegion(tenant_id)),
    /** A one-time WebSocket ticket body (ADR-021); the Worker seals it before handing it out. */
    issueWsTicket: async (
      input: Parameters<HubRpc['issueWsTicket']>[1],
    ): Promise<{ body: string; expires_at: string }> => unwrap(await stub.issueWsTicket(tenant_id, input)),
  };
}

export type HubClient = ReturnType<typeof hubFor>;
