import {
  ActionIdSchema,
  type Clock,
  type ConfirmChannel,
  ConfirmChannelSchema,
  CustomerIdSchema,
  HalynError,
  type HubRole,
  HubRoleSchema,
  type JsonValue,
  type LedgerEntry,
  LedgerEntrySchema,
  LedgerEntryTypeSchema,
  MoneySchema,
  type OutcomeEvent,
  type Region,
  RegionSchema,
  RequestIdSchema,
  type Rng,
  sha256Hex,
  TenantIdSchema,
  type WsMessage,
  WsMessageSchema,
} from '@halyn/shared';
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { type SessionKind, SessionKindSchema } from '../auth/session';
import { newTicketBody, roleAllowed, WS_TICKET_TTL_MS } from '../auth/ws-ticket';
import { type BolnaClient, createBolnaClient, type FetchLike } from '../bolna/client';
import type { CoreTransport } from '../core-client/client';
import { BolnaEnvSchema } from '../env';
import { defaultCoreTransport, signerFor } from '../flow/context';
import { coreUpdate } from '../flow/execute';
import { type LedgerHead, nextLedgerEntry } from '../ledger';
import { cryptoRng } from '../platform/crypto-rng';
import {
  attachCallback,
  beginExecution,
  type ExecutionResult,
  finishExecution,
  type HubCore,
  type IdentifyInput,
  IdentifyInputSchema,
  identify,
  mintCode,
  noteGrant,
  type ProposeInput,
  type ProposeOutcome,
  propose,
  settleRequest,
  verifyPass,
} from './flows';
import { type LedgerSink, tidbLedgerSink } from './ledger-sink';
import { type DirectorySource, type MirrorSink, tidbDirectorySource, tidbMirrorSink } from './ports';
import { type PresentAgain, presentGrant, SWEEP_DELAY_MS, sweepExecutions } from './reconcile';
import { type HubResult, toFailure } from './result';
import { HubStore } from './store';
import {
  type CallState,
  type CredentialRecord,
  CredentialRecordSchema,
  type DirectoryCustomer,
  type MirrorItem,
  type RequestRecord,
} from './types';

// One Hub per tenant (ADR-014, ADR-016): the single writer of the tenant's ledger, the idempotency cache, the
// confirmation timers, the WebSocket fan-out — and the call-time read model the Bolna tools answer from within
// 300 ms (customers, Passes, codes, passkeys, calls, requests), with TiDB as its mirror. Everything that must happen
// in order runs through `serial`, because any await (crypto, a callback, TiDB) would otherwise let a second request
// interleave. RPC methods never throw: they return a HubResult (result.ts), and the Worker uses them through client.ts.

const FLUSH_DELAY_MS = 250;
const FLUSH_BATCH = 100;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 300_000;
const MAX_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
/** Customers are re-read from TiDB (in the background) when the copy is older than this. */
const DIRECTORY_REFRESH_MS = 10 * 60 * 1000;

const systemClock: Clock = { nowMs: () => Date.now() };

const AppendInputSchema = z.strictObject({
  type: LedgerEntryTypeSchema,
  ref_id: z.string().min(1).max(64),
  payload: z.record(z.string(), z.json()),
});
export type HubAppend = z.input<typeof AppendInputSchema>;

const StartConfirmationSchema = z.strictObject({
  request_id: RequestIdSchema,
  channels: z
    .array(ConfirmChannelSchema)
    .min(1)
    .refine((c) => new Set(c).size === c.length),
  timeout_seconds: z.int().min(1).max(600),
  /** What the Aero app's approval sheet shows; broadcast as `confirm_request` when given. */
  prompt: z
    .strictObject({
      action: ActionIdSchema,
      summary: z.string().min(1).max(300),
      amount: MoneySchema.nullable(),
    })
    .optional(),
});
export type StartConfirmation = z.input<typeof StartConfirmationSchema>;

const ResolveConfirmationSchema = z.strictObject({
  request_id: RequestIdSchema,
  answer: z.enum(['approved', 'declined']),
  channel: ConfirmChannelSchema,
});
export type ConfirmationStatus = 'approved' | 'declined' | 'timeout';
export interface ConfirmationOutcome {
  /** True only for the first answer; later answers are recorded and ignored (invariant 10). */
  accepted: boolean;
  status: ConfirmationStatus;
  channel: ConfirmChannel | null;
}

const KeySchema = z.string().min(1).max(200);

const WsTicketInputSchema = z
  .strictObject({
    kind: SessionKindSchema,
    customer_id: CustomerIdSchema.nullable(),
    role: HubRoleSchema,
  })
  .refine((t) => (t.kind === 'customer') === (t.customer_id !== null));

interface TicketRow extends Record<string, SqlStorageValue> {
  kind: string;
  customer_id: string | null;
  role: string;
  expires_at: number;
}

interface PendingRow extends Record<string, SqlStorageValue> {
  request_id: string;
  deadline: number;
}
interface ResultRow extends Record<string, SqlStorageValue> {
  status: string;
  channel: string | null;
}

/** A customer's slice of the Hub for the Aero app's home. */
export interface CustomerView {
  customer: DirectoryCustomer | null;
  requests: RequestRecord[];
  passkeys: number;
}

function failClosed(message: string): never {
  throw new HalynError('E_FAIL_CLOSED', `hub: ${message}`);
}

export class HubDO extends DurableObject<Env> {
  /** Test seam (set through runInDurableObject); production uses the system clock. */
  clock: Clock = systemClock;
  /** Test seam; production uses WebCrypto. */
  rng: Rng = cryptoRng;
  /** Test seam; production persists to TiDB. */
  sink: LedgerSink | null = null;
  /** Test seams (ADR-016); production loads from and mirrors to TiDB. */
  source: DirectorySource | null = null;
  mirrorSink: MirrorSink | null = null;
  /** Test seam: how the Hub reaches Bolna for the timeout event (production: the global fetch). */
  bolnaFetch: FetchLike | null = null;
  /**
   * Test seam: how the sweep reaches Aero Core to present a dead Worker's grant again (ADR-020). Undefined: the
   * AERO_CORE binding or AERO_CORE_URL, as the Worker; null: no Aero Core.
   */
  coreTransport: CoreTransport | null | undefined = undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<HubResult<string>>>();
  private readonly store: HubStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec(
      'CREATE TABLE IF NOT EXISTS ledger (seq INTEGER PRIMARY KEY, entry TEXT NOT NULL, persisted_at INTEGER)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS ledger_head (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, hash TEXT NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, response TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS pending_confirmations (request_id TEXT PRIMARY KEY, channels TEXT NOT NULL, deadline INTEGER NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS confirmation_results (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, channel TEXT, decided_at INTEGER NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS confirmation_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, answer TEXT NOT NULL, channel TEXT NOT NULL, accepted INTEGER NOT NULL, at INTEGER NOT NULL)',
    );
    // One-time WebSocket tickets (ADR-021): only the SHA-256 of each, until it is used or expires.
    sql.exec(
      'CREATE TABLE IF NOT EXISTS ws_tickets (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, customer_id TEXT, role TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    );
    this.store = new HubStore(sql);
  }

  // ── plumbing ────────────────────────────────────────────────────────────────────────────────────

  /** Run an RPC body and return its outcome as a value; nothing thrown crosses the RPC boundary. */
  private async guard<T>(fn: () => Promise<T> | T): Promise<HubResult<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      if (!(err instanceof HalynError))
        console.log(
          JSON.stringify({
            level: 'error',
            hub: 'unexpected',
            detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
          }),
        );
      return toFailure(err);
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private meta(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
      .toArray()[0];
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', key);
    else this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
  }

  /** A Hub serves exactly one tenant: the first call binds it, any other tenant fails closed (invariant 8). */
  private bindTenant(tenant_id: unknown): string {
    const parsed = TenantIdSchema.safeParse(tenant_id);
    if (!parsed.success) failClosed('invalid tenant id');
    const bound = this.meta('tenant');
    if (bound === null) this.setMeta('tenant', parsed.data);
    else if (bound !== parsed.data) failClosed('tenant mismatch');
    return parsed.data;
  }

  private boundTenant(): string {
    return this.meta('tenant') ?? failClosed('no tenant bound yet');
  }

  private head(): LedgerHead | null {
    const row = this.ctx.storage.sql
      .exec<{ seq: number; hash: string }>('SELECT seq, hash FROM ledger_head WHERE id = 1')
      .toArray()[0];
    return row ? { seq: row.seq, hash: row.hash } : null;
  }

  /**
   * One alarm multiplexes the earliest confirmation deadline, the next outbox flush (ledger and mirror) and the next
   * sweep of executions in flight and of approvals no Worker has claimed (ADR-020).
   */
  private async scheduleAlarm(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const deadline = sql
      .exec<{ d: number | null }>('SELECT MIN(deadline) AS d FROM pending_confirmations')
      .toArray()[0]?.d;
    const unflushed =
      sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM ledger WHERE persisted_at IS NULL').toArray()[0]
        ?.n ?? 0;
    const retryAt = this.meta('flush_retry_at');
    const flushAt =
      unflushed > 0 ? (retryAt === null ? this.clock.nowMs() + FLUSH_DELAY_MS : Number(retryAt)) : null;
    const mirrorRetry = this.meta('mirror_retry_at');
    const mirrorAt =
      this.store.mirrorCount() > 0
        ? mirrorRetry === null
          ? this.clock.nowMs() + FLUSH_DELAY_MS
          : Number(mirrorRetry)
        : null;
    const oldest = this.store.oldestExecution();
    const sweepAt = oldest === null ? null : oldest + SWEEP_DELAY_MS;
    const unclaimed = this.store.oldestApproval();
    const claimBy = unclaimed === null ? null : unclaimed + SWEEP_DELAY_MS;
    const next = [deadline, flushAt, mirrorAt, sweepAt, claimBy].filter(
      (t): t is number => typeof t === 'number',
    );
    if (next.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...next));
  }

  private send(message: WsMessage, roles?: readonly HubRole[]): number {
    const text = JSON.stringify(WsMessageSchema.parse(message));
    const sockets = roles ? roles.flatMap((role) => this.ctx.getWebSockets(role)) : this.ctx.getWebSockets();
    let sent = 0;
    for (const ws of sockets) {
      try {
        ws.send(text);
        sent += 1;
      } catch {
        // A socket that closed mid-broadcast: the app refetches on reconnect.
      }
    }
    return sent;
  }

  /** The lane-side surface flows.ts works with. Caller holds the lane and has bound the tenant. */
  private core(tenant: string): HubCore {
    return {
      tenant,
      store: this.store,
      clock: this.clock,
      rng: this.rng,
      env: this.env as unknown as { PASS_CODE_PEPPER?: unknown },
      append: (input) => this.appendNow(tenant, input),
      send: (message, roles) => {
        this.send(message, roles);
      },
      openConfirmation: async (input) => {
        const { deadline } = await this.openConfirmationNow(tenant, input);
        return Date.parse(deadline);
      },
      mirror: (item: MirrorItem) => this.store.enqueue(item),
    };
  }

  // ── directory (ADR-016) ───────────────────────────────────────────────────────────────────────

  /** Load customers, Passes, codes and passkeys from TiDB the first time; refresh customers when stale. */
  private async ensureDirectory(tenant: string): Promise<void> {
    const loadedAt = this.meta('directory_at');
    const now = this.clock.nowMs();
    if (loadedAt !== null && now - Number(loadedAt) < DIRECTORY_REFRESH_MS) return;
    this.source ??= tidbDirectorySource(this.env);
    const load = async () => {
      const snapshot = await (this.source as DirectorySource).load(tenant, now);
      this.store.loadDirectory(snapshot);
      this.setMeta('directory_at', String(now));
    };
    if (loadedAt === null) {
      await load();
      return;
    }
    // Stale but present: answer from the copy and refresh in the background (never blocks a tool).
    this.setMeta('directory_at', String(now));
    this.ctx.waitUntil(
      this.serial(load).catch((err: unknown) =>
        console.log(
          JSON.stringify({
            level: 'warn',
            hub: 'directory_refresh_failed',
            detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
          }),
        ),
      ),
    );
  }

  /** Load the directory now (the web session warms the Hub so the first call does not wait for TiDB). */
  async warm(tenant_id: string): Promise<HubResult<number>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        await this.ensureDirectory(tenant);
        return this.store.customers().length;
      }),
    );
  }

  // ── Bolna tools (ADR-016) ─────────────────────────────────────────────────────────────────────

  /** lookup_customer: identify the caller by number (or claimed name, never proof) and register the call. */
  async identifyCaller(
    tenant_id: string,
    input: IdentifyInput,
  ): Promise<HubResult<{ call: CallState; customer: DirectoryCustomer | null }>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        await this.ensureDirectory(tenant);
        return identify(this.core(tenant), IdentifyInputSchema.parse(input));
      }),
    );
  }

  /** verify_pass. */
  async verifyPassCode(
    tenant_id: string,
    input: { run_id: string; call_sid: string | null; from_number: string; code: string; region: Region },
  ): Promise<HubResult<{ valid: false } | { valid: true; assistant_name: string; scopes: string[] }>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        await this.ensureDirectory(tenant);
        return verifyPass(this.core(tenant), { ...input, region: RegionSchema.parse(input.region) });
      }),
    );
  }

  /** get_pass_code (the Worker has verified the Pass token's signature and claims). */
  async mintPassCode(
    tenant_id: string,
    input: { pass_id: string; calling_number: string },
  ): Promise<HubResult<{ ok: true; code: string } | { ok: false; reason: string }>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        await this.ensureDirectory(tenant);
        return mintCode(this.core(tenant), input);
      }),
    );
  }

  /** propose_action: idempotency, the Gate, the record, the ledger and (for a step-up) the confirmation timer. */
  async propose(tenant_id: string, input: ProposeInput): Promise<HubResult<ProposeOutcome>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        await this.ensureDirectory(tenant);
        const outcome = await propose(this.core(tenant), input);
        await this.scheduleAlarm();
        return outcome;
      }),
    );
  }

  async requestState(tenant_id: string, request_id: string): Promise<HubResult<RequestRecord | null>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      return this.store.request(request_id);
    });
  }

  /** The run id of a call Bolna told us about (webhook) by its call sid: the fallback when `%(execution_id)s` is empty. */
  async runIdForCallSid(tenant_id: string, call_sid: string): Promise<HubResult<string | null>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      return this.store.runIdForCallSid(call_sid);
    });
  }

  /** Webhook: register a call (run id ↔ call sid) or update it (ended, recording). Idempotent per execution. */
  async recordExecution(
    tenant_id: string,
    input: {
      run_id: string;
      call_sid: string | null;
      ended: boolean;
      recording_url: string | null;
      purpose: string | null;
    },
  ): Promise<HubResult<boolean>> {
    return this.guard(() =>
      this.serial(async () => {
        this.bindTenant(tenant_id);
        const now = this.clock.nowMs();
        const existing = this.store.call(input.run_id);
        const call: CallState = existing
          ? {
              ...existing,
              call_sid: existing.call_sid ?? input.call_sid,
              ended_at: input.ended ? (existing.ended_at ?? now) : existing.ended_at,
              purpose: existing.purpose ?? input.purpose,
            }
          : {
              id: `call_${input.run_id.replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || 'unknown'}`,
              run_id: input.run_id,
              call_sid: input.call_sid,
              channel: 'phone',
              region: 'IN',
              customer_id: null,
              registered: false,
              number_hash: null,
              from_last4: null,
              kind: 'unknown',
              pass_id: null,
              app_session_customer_id: null,
              started_at: now,
              ended_at: input.ended ? now : null,
              purpose: input.purpose,
            };
        this.store.putCall(call);
        this.store.enqueue({
          kind: 'call',
          row: JSON.parse(
            JSON.stringify({
              id: call.id,
              run_id: call.run_id,
              agent: 'aero',
              channel: call.channel,
              from_number_last4: call.from_last4,
              started_at: call.started_at,
              ended_at: call.ended_at,
              purpose: call.purpose,
              recording_url: input.recording_url,
            }),
          ) as Record<string, JsonValue>,
        });
        await this.scheduleAlarm();
        return existing === null;
      }),
    );
  }

  // ── execution book-keeping ───────────────────────────────────────────────────────────────────

  async beginExecution(tenant_id: string, request_id: string): Promise<HubResult<RequestRecord | null>> {
    return this.guard(() =>
      this.serial(async () => {
        const claimed = beginExecution(this.core(this.bindTenant(tenant_id)), request_id);
        // Arms the sweep: if this Worker dies before finishExecution, the alarm resolves the request (ADR-020).
        await this.scheduleAlarm();
        return claimed;
      }),
    );
  }

  /** The grant the Worker is about to present (compact JWS): kept here only, for the sweep (ADR-020). */
  async noteGrant(tenant_id: string, request_id: string, grant: { token: string }): Promise<HubResult<true>> {
    return this.guard(() =>
      this.serial(async () => {
        await noteGrant(this.core(this.bindTenant(tenant_id)), request_id, grant);
        await this.scheduleAlarm();
        return true as const;
      }),
    );
  }

  /** Null when the request was already final (the sweep finished first): first finish wins, nothing changes. */
  async finishExecution(
    tenant_id: string,
    request_id: string,
    result: ExecutionResult,
  ): Promise<HubResult<RequestRecord | null>> {
    return this.guard(() =>
      this.serial(async () => {
        const record = await finishExecution(this.core(this.bindTenant(tenant_id)), request_id, result);
        await this.scheduleAlarm();
        return record;
      }),
    );
  }

  async attachCallback(
    tenant_id: string,
    request_id: string,
    execution_id: string | null,
  ): Promise<HubResult<true>> {
    return this.guard(() =>
      this.serial(async () => {
        attachCallback(this.core(this.bindTenant(tenant_id)), request_id, execution_id);
        await this.scheduleAlarm();
        return true as const;
      }),
    );
  }

  // ── the Aero app: home view, passkeys ────────────────────────────────────────────────────────

  async customerView(tenant_id: string, customer_id: string): Promise<HubResult<CustomerView>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        await this.ensureDirectory(tenant);
        return {
          customer: this.store.customer(customer_id),
          requests: this.store.latestRequests(customer_id, 20),
          passkeys: this.store.credentials(customer_id).length,
        };
      }),
    );
  }

  async putChallenge(
    tenant_id: string,
    input: {
      challenge: string;
      kind: 'register' | 'approve';
      customer_id: string;
      request_id: string | null;
      expires_at: number;
    },
  ): Promise<HubResult<true>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      this.store.putChallenge(input);
      return true as const;
    });
  }

  async takeChallenge(
    tenant_id: string,
    input: {
      challenge: string;
      kind: 'register' | 'approve';
      customer_id: string;
      request_id: string | null;
    },
  ): Promise<HubResult<boolean>> {
    return this.guard(() =>
      this.serial(async () => {
        this.bindTenant(tenant_id);
        return this.store.takeChallenge({ ...input, now: this.clock.nowMs() });
      }),
    );
  }

  async passkeys(tenant_id: string, customer_id: string): Promise<HubResult<CredentialRecord[]>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        await this.ensureDirectory(tenant);
        return this.store.credentials(customer_id);
      }),
    );
  }

  /** Save a new passkey (or a sign-count bump) and mirror the customer's passkeys to TiDB. */
  async savePasskey(tenant_id: string, credential: CredentialRecord): Promise<HubResult<true>> {
    return this.guard(() =>
      this.serial(async () => {
        this.bindTenant(tenant_id);
        const record = CredentialRecordSchema.parse(credential);
        const existing = this.store.credential(record.id);
        if (existing && existing.customer_id !== record.customer_id)
          failClosed('passkey belongs to another customer');
        this.store.putCredential(record);
        this.store.enqueue({
          kind: 'credentials',
          row: JSON.parse(
            JSON.stringify({
              customer_id: record.customer_id,
              credentials: this.store.credentials(record.customer_id),
            }),
          ) as Record<string, JsonValue>,
        });
        await this.scheduleAlarm();
        return true as const;
      }),
    );
  }

  // ── Stage ───────────────────────────────────────────────────────────────────────────────────

  async setStageRegion(tenant_id: string, region: Region): Promise<HubResult<Region>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      const parsed = RegionSchema.parse(region);
      this.setMeta('stage_region', parsed);
      return parsed;
    });
  }

  async stageRegion(tenant_id: string): Promise<HubResult<Region>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      return RegionSchema.catch('IN').parse(this.meta('stage_region'));
    });
  }

  // ── ledger ──────────────────────────────────────────────────────────────────────────────────────

  /** Caller must already hold the serial lane. */
  private async appendNow(tenant_id: string, input: HubAppend): Promise<LedgerEntry> {
    const parsed = AppendInputSchema.safeParse(input);
    if (!parsed.success) failClosed('invalid ledger append');
    const entry = await nextLedgerEntry(this.head(), { tenant_id, ...parsed.data }, this.clock);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'INSERT INTO ledger (seq, entry, persisted_at) VALUES (?, ?, NULL)',
        entry.seq,
        JSON.stringify(entry),
      );
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO ledger_head (id, seq, hash) VALUES (1, ?, ?)',
        entry.seq,
        entry.hash,
      );
    });
    await this.scheduleAlarm();
    this.send(
      {
        type: 'ledger_append',
        at: entry.created_at,
        seq: entry.seq,
        entry_type: entry.type,
        ref_id: entry.ref_id,
        hash: entry.hash,
        prev_hash: entry.prev_hash,
        chain_ok: true,
      },
      ['stage', 'console'],
    );
    return entry;
  }

  /** Append the next entry of this tenant's chain. Concurrent calls are applied strictly one after another. */
  async appendLedger(tenant_id: string, input: HubAppend): Promise<HubResult<LedgerEntry>> {
    return this.guard(() => this.serial(async () => this.appendNow(this.bindTenant(tenant_id), input)));
  }

  /** The chain head — the anchor for `verifyLedgerChain` (ADR-012). */
  async ledgerHead(tenant_id: string): Promise<HubResult<LedgerHead | null>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      return this.head();
    });
  }

  /** Entries from the Hub's own copy, in seq order (the TiDB copy may lag by one flush). */
  async ledgerEntries(tenant_id: string, fromSeq = 1, limit = 1000): Promise<HubResult<LedgerEntry[]>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      return this.ctx.storage.sql
        .exec<{ entry: string }>(
          'SELECT entry FROM ledger WHERE seq >= ? ORDER BY seq LIMIT ?',
          fromSeq,
          Math.min(limit, 5000),
        )
        .toArray()
        .map((row) => LedgerEntrySchema.parse(JSON.parse(row.entry)));
    });
  }

  /** Push unpersisted entries to the sink in seq order; on failure keep them and back off (caller holds the lane). */
  private async flushNow(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const rows = sql
      .exec<{ seq: number; entry: string }>(
        'SELECT seq, entry FROM ledger WHERE persisted_at IS NULL ORDER BY seq LIMIT ?',
        FLUSH_BATCH,
      )
      .toArray();
    if (rows.length === 0) return;
    const entries = rows.map((r) => LedgerEntrySchema.parse(JSON.parse(r.entry)));
    const now = this.clock.nowMs();
    try {
      this.sink ??= tidbLedgerSink(this.env);
      await this.sink.persist(this.boundTenant(), entries);
      const last = entries.at(-1)?.seq ?? 0;
      sql.exec('UPDATE ledger SET persisted_at = ? WHERE persisted_at IS NULL AND seq <= ?', now, last);
      this.setMeta('flush_attempts', null);
      this.setMeta('flush_retry_at', null);
    } catch (err) {
      this.backOff('flush', now, err);
    }
  }

  private backOff(kind: 'flush' | 'mirror', now: number, err: unknown): void {
    const attempts = Number(this.meta(`${kind}_attempts`) ?? '0') + 1;
    this.setMeta(`${kind}_attempts`, String(attempts));
    this.setMeta(
      `${kind}_retry_at`,
      String(now + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS)),
    );
    console.log(
      JSON.stringify({
        level: 'warn',
        at: new Date(now).toISOString(),
        hub: kind === 'flush' ? 'ledger_flush_failed' : 'mirror_flush_failed',
        attempts,
        detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
      }),
    );
  }

  /** Push the mirror outbox to TiDB in order; on failure keep it and back off (caller holds the lane). */
  private async flushMirror(): Promise<void> {
    const pending = this.store.pendingMirror(FLUSH_BATCH);
    if (pending.length === 0) return;
    const now = this.clock.nowMs();
    try {
      this.mirrorSink ??= tidbMirrorSink(this.env);
      await this.mirrorSink.persist(
        this.boundTenant(),
        pending.map((p) => p.item),
      );
      this.store.dropMirror(pending.at(-1)?.id ?? 0);
      this.setMeta('mirror_attempts', null);
      this.setMeta('mirror_retry_at', null);
    } catch (err) {
      this.backOff('mirror', now, err);
    }
  }

  // ── idempotency (invariant 7) ─────────────────────────────────────────────────────────────────

  /**
   * Run `compute` at most once per key while its result is fresh, and give every caller — repeats and concurrent
   * duplicates — the identical stored result. `compute` returns a HubResult; a failure is passed back to every
   * waiter and stored nowhere, so the next attempt recomputes.
   */
  async idempotent<T extends JsonValue>(
    tenant_id: string,
    key: string,
    ttlSeconds: number,
    compute: () => Promise<HubResult<T>> | HubResult<T>,
  ): Promise<HubResult<T>> {
    return this.guard(async () => {
      this.bindTenant(tenant_id);
      if (!KeySchema.safeParse(key).success) failClosed('invalid idempotency key');
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_IDEMPOTENCY_TTL_SECONDS)
        failClosed('invalid idempotency ttl');
      const now = this.clock.nowMs();
      const stored = this.ctx.storage.sql
        .exec<{ response: string; expires_at: number }>(
          'SELECT response, expires_at FROM idempotency WHERE key = ?',
          key,
        )
        .toArray()[0];
      if (stored && stored.expires_at > now) return JSON.parse(stored.response) as T;
      let run = this.inflight.get(key);
      if (!run) {
        run = (async (): Promise<HubResult<string>> => {
          const result = await compute();
          if (!result.ok) return result;
          const text = JSON.stringify(result.value);
          if (text === undefined) failClosed('idempotent result is not JSON');
          this.ctx.storage.sql.exec(
            'INSERT OR REPLACE INTO idempotency (key, response, expires_at) VALUES (?, ?, ?)',
            key,
            text,
            now + ttlSeconds * 1000,
          );
          return { ok: true, value: text };
        })();
        this.inflight.set(key, run);
        run.then(
          () => this.inflight.delete(key),
          () => this.inflight.delete(key),
        );
      }
      const outcome = await run;
      if (!outcome.ok) throw new HalynError(outcome.code, outcome.message);
      return JSON.parse(outcome.value) as T;
    });
  }

  // ── confirmations (invariant 10) ──────────────────────────────────────────────────────────────

  /** Caller holds the lane. */
  private async openConfirmationNow(tenant: string, input: StartConfirmation): Promise<{ deadline: string }> {
    const parsed = StartConfirmationSchema.safeParse(input);
    if (!parsed.success) failClosed('invalid confirmation');
    const { request_id, channels, timeout_seconds, prompt } = parsed.data;
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<PendingRow>(
        'SELECT request_id, deadline FROM pending_confirmations WHERE request_id = ?',
        request_id,
      )
      .toArray()[0];
    if (existing) return { deadline: new Date(existing.deadline).toISOString() };
    if (sql.exec('SELECT 1 FROM confirmation_results WHERE request_id = ?', request_id).toArray().length > 0)
      failClosed('confirmation already resolved');
    const deadline = this.clock.nowMs() + timeout_seconds * 1000;
    sql.exec(
      'INSERT INTO pending_confirmations (request_id, channels, deadline) VALUES (?, ?, ?)',
      request_id,
      JSON.stringify(channels),
      deadline,
    );
    const expires_at = new Date(deadline).toISOString();
    await this.appendNow(tenant, {
      type: 'confirm_requested',
      ref_id: request_id,
      payload: { channels, expires_at },
    });
    if (prompt)
      this.send(
        {
          type: 'confirm_request',
          at: new Date(this.clock.nowMs()).toISOString(),
          request_id,
          action: prompt.action,
          summary: prompt.summary,
          amount: prompt.amount,
          channels,
          expires_at,
        },
        ['aero', 'stage'],
      );
    await this.scheduleAlarm();
    return { deadline: expires_at };
  }

  async startConfirmation(
    tenant_id: string,
    input: StartConfirmation,
  ): Promise<HubResult<{ deadline: string }>> {
    return this.guard(() =>
      this.serial(async () => this.openConfirmationNow(this.bindTenant(tenant_id), input)),
    );
  }

  /**
   * Caller holds the lane. Records the outcome, appends the ledger entry, tells every app — and, when a proposal is
   * behind this confirmation, settles it into its final outcome (flows.ts settleRequest).
   */
  private async settle(
    tenant: string,
    request_id: string,
    status: ConfirmationStatus,
    channel: ConfirmChannel | null,
  ): Promise<RequestRecord | null> {
    const now = this.clock.nowMs();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM pending_confirmations WHERE request_id = ?', request_id);
      this.ctx.storage.sql.exec(
        'INSERT INTO confirmation_results (request_id, status, channel, decided_at) VALUES (?, ?, ?, ?)',
        request_id,
        status,
        channel,
        now,
      );
    });
    await this.appendNow(tenant, {
      type: 'confirmed',
      ref_id: request_id,
      payload:
        status === 'timeout'
          ? { status, channel: null, reason: 'C_TIMEOUT' }
          : { status, channel, reason: status === 'approved' ? 'C_APPROVED' : 'C_DECLINED' },
    });
    this.send({ type: 'confirm_resolved', at: new Date(now).toISOString(), request_id, status, channel });
    const record = await settleRequest(this.core(tenant), request_id, status);
    if (record) {
      for (const c of record.confirm?.channels ?? [])
        this.store.enqueue({
          kind: 'confirmation',
          row: {
            id: `cnf_${request_id.slice(4)}_${c === 'callback' ? 'cb' : 'pk'}`,
            request_id,
            channel: c,
            status: c === channel ? status : status === 'timeout' ? 'timeout' : 'superseded',
            answer: c === channel ? status : null,
            bolna_execution_id: c === 'callback' ? (record.confirm?.execution_id ?? null) : null,
            answered_at: c === channel ? now : null,
          },
        });
    }
    return record;
  }

  /**
   * First answer wins; any later answer is recorded and ignored. The deadline is checked here, not only by the alarm:
   * an answer at or after it while the alarm is late (queued, or the Hub was busy) settles the timeout first — the
   * alarm's own path: deny C_TIMEOUT, ledger, apps, and the `timeout` event — and is then recorded as ignored.
   */
  async resolveConfirmation(
    tenant_id: string,
    input: z.input<typeof ResolveConfirmationSchema>,
  ): Promise<HubResult<ConfirmationOutcome>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
        const parsed = ResolveConfirmationSchema.safeParse(input);
        if (!parsed.success) failClosed('invalid confirmation answer');
        const { request_id, answer, channel } = parsed.data;
        const sql = this.ctx.storage.sql;
        const now = this.clock.nowMs();
        const pending = sql
          .exec<PendingRow>(
            'SELECT request_id, deadline FROM pending_confirmations WHERE request_id = ?',
            request_id,
          )
          .toArray()[0];
        const record = (accepted: boolean) =>
          sql.exec(
            'INSERT INTO confirmation_answers (request_id, answer, channel, accepted, at) VALUES (?, ?, ?, ?, ?)',
            request_id,
            answer,
            channel,
            accepted ? 1 : 0,
            now,
          );
        if (pending && now < pending.deadline) {
          record(true);
          await this.settle(tenant, request_id, answer, channel);
          await this.scheduleAlarm();
          return { accepted: true, status: answer, channel };
        }
        if (pending) {
          const timedOut = await this.settle(tenant, request_id, 'timeout', null);
          record(false);
          await this.scheduleAlarm();
          // Nobody else will tell the call now (the alarm finds nothing left to settle): the same event the alarm sends.
          if (timedOut) this.ctx.waitUntil(this.tellTimeouts([timedOut]).catch(() => undefined));
          return { accepted: false, status: 'timeout', channel: null };
        }
        const result = sql
          .exec<ResultRow>(
            'SELECT status, channel FROM confirmation_results WHERE request_id = ?',
            request_id,
          )
          .toArray()[0];
        if (!result) throw new HalynError('E_NOT_FOUND', 'No such confirmation');
        record(false);
        return {
          accepted: false,
          status: result.status as ConfirmationStatus,
          channel: result.channel as ConfirmChannel | null,
        };
      }),
    );
  }

  /** The settled outcome of a confirmation, or null while it is pending or unknown. */
  async confirmationResult(
    tenant_id: string,
    request_id: string,
  ): Promise<HubResult<ConfirmationOutcome | null>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      const result = this.ctx.storage.sql
        .exec<ResultRow>('SELECT status, channel FROM confirmation_results WHERE request_id = ?', request_id)
        .toArray()[0];
      return result
        ? {
            accepted: true,
            status: result.status as ConfirmationStatus,
            channel: result.channel as ConfirmChannel | null,
          }
        : null;
    });
  }

  /** Bolna, for the timeout event the Hub itself sends (nobody else is awake when the 60 s run out). */
  private bolna(): BolnaClient | null {
    const parsed = BolnaEnvSchema.safeParse(this.env);
    if (!parsed.success) return null;
    return createBolnaClient({
      apiKey: parsed.data.BOLNA_API_KEY,
      baseUrl: parsed.data.BOLNA_API_BASE,
      fetch: this.bolnaFetch ?? ((request) => fetch(request)),
    });
  }

  /** The sweep's way to Aero Core: the test seam, else the Worker's default (binding or URL). */
  private aeroCore(): CoreTransport | null {
    return this.coreTransport === undefined ? defaultCoreTransport(this.env) : this.coreTransport;
  }

  /**
   * Outside the lane: present each dead Worker's grant again (Aero Core may take seconds), then record the answer in
   * the lane — first finish wins against a Worker that comes back late — and tell the apps. Returns what this sweep
   * finished; a failure leaves the request for the next sweep, which fails closed once the grant has expired.
   */
  private async presentAgain(tenant: string, items: readonly PresentAgain[]): Promise<RequestRecord[]> {
    if (items.length === 0) return [];
    const transport = this.aeroCore();
    const finished = await Promise.all(
      items.map(async (item) => {
        try {
          const { result, body } = await presentGrant(transport, item, this.clock);
          const record = await this.serial(async () => {
            const done = await finishExecution(this.core(tenant), item.record.request_id, result, {
              by: 'sweep',
              detail: 'represented',
            });
            await this.scheduleAlarm();
            return done;
          });
          if (record?.status === 'executed')
            await coreUpdate(
              {
                tenant,
                core: transport,
                clock: this.clock,
                rng: this.rng,
                signer: () => signerFor(this.env),
                broadcast: async (message) => this.send(message),
              },
              record,
              body,
            );
          return record;
        } catch (err) {
          console.log(
            JSON.stringify({
              level: 'error',
              hub: 'sweep_present_failed',
              request_id: item.record.request_id,
              detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
            }),
          );
          return null;
        }
      }),
    );
    return finished.filter((r): r is RequestRecord => r !== null);
  }

  override async alarm(): Promise<void> {
    const swept = await this.serial(async () => {
      const tenant = this.meta('tenant');
      if (tenant === null) return null;
      const now = this.clock.nowMs();
      const due = this.ctx.storage.sql
        .exec<PendingRow>(
          'SELECT request_id, deadline FROM pending_confirmations WHERE deadline <= ? ORDER BY deadline, request_id',
          now,
        )
        .toArray();
      const timedOut: RequestRecord[] = [];
      for (const row of due) {
        const record = await this.settle(tenant, row.request_id, 'timeout', null);
        if (record) timedOut.push(record);
      }
      // Executions whose Worker died (ADR-020): settled here, or handed back to present their grant again.
      const { finished, present } = await sweepExecutions(this.core(tenant));
      this.ctx.storage.sql.exec('DELETE FROM idempotency WHERE expires_at <= ?', now);
      const retryAt = this.meta('flush_retry_at');
      if (retryAt === null || Number(retryAt) <= now) await this.flushNow();
      const mirrorRetry = this.meta('mirror_retry_at');
      if (mirrorRetry === null || Number(mirrorRetry) <= now) await this.flushMirror();
      return { tenant, timedOut, finished, present };
    });
    await this.scheduleAlarm();
    if (swept === null) return;
    const presented = await this.presentAgain(swept.tenant, swept.present);
    // Outside the lane: tell each call its outcome once — a confirmation that timed out (and stop a Confirm call still
    // queued), or an execution the sweep finished.
    const resolved = [...swept.finished, ...presented];
    const bolna = resolved.length > 0 ? this.bolna() : null;
    await Promise.all([
      this.tellTimeouts(swept.timedOut),
      ...resolved.map(async (record) => {
        if (bolna && record.last_event)
          await bolna.sendEvent(record.run_id, record.last_event as OutcomeEvent);
      }),
    ]);
  }

  /** The `timeout` event to each call whose confirmation timed out, and stop its Confirm call if still queued. */
  private async tellTimeouts(records: readonly RequestRecord[]): Promise<void> {
    const bolna = records.length > 0 ? this.bolna() : null;
    if (!bolna) return;
    await Promise.all(
      records.map(async (record) => {
        if (!record.last_event) return;
        await bolna.sendEvent(record.run_id, record.last_event as OutcomeEvent);
        if (record.confirm?.execution_id) await bolna.stopCall(record.confirm.execution_id);
      }),
    );
  }

  // ── WebSockets (Hibernation API) ──────────────────────────────────────────────────────────────

  /**
   * POST /web/ws-ticket: a one-time ticket body for one socket, bound to this tenant, the session's kind and customer
   * and one role, for 30 s (ADR-021). Only its SHA-256 is kept; the Worker seals the body before handing it out.
   */
  async issueWsTicket(
    tenant_id: string,
    input: z.input<typeof WsTicketInputSchema>,
  ): Promise<HubResult<{ body: string; expires_at: string }>> {
    return this.guard(async () => {
      const tenant = this.bindTenant(tenant_id);
      const parsed = WsTicketInputSchema.safeParse(input);
      if (!parsed.success) failClosed('invalid ticket request');
      const { kind, customer_id, role } = parsed.data;
      if (!roleAllowed(kind, role)) failClosed('role not allowed for this session');
      const now = this.clock.nowMs();
      const body = newTicketBody(tenant, this.rng);
      const hash = await sha256Hex(body);
      const sql = this.ctx.storage.sql;
      sql.exec('DELETE FROM ws_tickets WHERE expires_at <= ?', now);
      sql.exec(
        'INSERT INTO ws_tickets (hash, kind, customer_id, role, expires_at) VALUES (?, ?, ?, ?, ?)',
        hash,
        kind,
        customer_id,
        role,
        now + WS_TICKET_TTL_MS,
      );
      return { body, expires_at: new Date(now + WS_TICKET_TTL_MS).toISOString() };
    });
  }

  /** Use a ticket up: whatever the outcome it is gone, so it opens at most one socket, for its own role, in time. */
  private async takeTicket(
    body: string | null,
    role: HubRole,
  ): Promise<{ kind: SessionKind; customer_id: string | null } | null> {
    if (body === null || body.length > 200) return null;
    const hash = await sha256Hex(body);
    // No await from here on: the read and the delete are one step, even against a concurrent upgrade.
    const now = this.clock.nowMs();
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<TicketRow>('SELECT kind, customer_id, role, expires_at FROM ws_tickets WHERE hash = ?', hash)
      .toArray()[0];
    sql.exec('DELETE FROM ws_tickets WHERE hash = ? OR expires_at <= ?', hash, now);
    const kind = SessionKindSchema.safeParse(row?.kind);
    if (!row || !kind.success || row.expires_at <= now || row.role !== role || !roleAllowed(kind.data, role))
      return null;
    return { kind: kind.data, customer_id: row.customer_id };
  }

  /**
   * `GET /ws` forwarded by the API Worker after it checked the ticket's seal; the Hub uses the ticket up (ADR-021).
   * The role becomes the socket's tag (and a customer's socket is also tagged with the customer).
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Not found', { status: 404 });
    const role = HubRoleSchema.safeParse(request.headers.get('x-halyn-role'));
    if (!role.success) return new Response('Bad role', { status: 400 });
    try {
      this.bindTenant(request.headers.get('x-halyn-tenant'));
    } catch {
      return new Response('Wrong tenant', { status: 403 });
    }
    const holder = await this.takeTicket(request.headers.get('x-halyn-ticket'), role.data);
    if (!holder) return new Response('Bad ticket', { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(
      server,
      holder.customer_id === null ? [role.data] : [role.data, `customer:${holder.customer_id}`],
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Apps only listen (actions go over REST); a ping keeps proxies from closing an idle socket.
    if (message === 'ping') ws.send('pong');
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing');
    } catch {
      // already closed
    }
  }

  /** Broadcast a validated Hub message to every socket, or to the given roles. Returns how many got it. */
  async broadcast(tenant_id: string, message: WsMessage, roles?: HubRole[]): Promise<HubResult<number>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      if (roles && !roles.every((r) => HubRoleSchema.safeParse(r).success)) failClosed('invalid role');
      const parsed = WsMessageSchema.safeParse(message);
      if (!parsed.success) failClosed('invalid message');
      return this.send(parsed.data, roles);
    });
  }

  /** How many sockets are open per role (Console "Integrations", tests). */
  async sockets(tenant_id: string): Promise<HubResult<Record<HubRole, number>>> {
    return this.guard(() => {
      this.bindTenant(tenant_id);
      return {
        stage: this.ctx.getWebSockets('stage').length,
        console: this.ctx.getWebSockets('console').length,
        aero: this.ctx.getWebSockets('aero').length,
        assistant: this.ctx.getWebSockets('assistant').length,
      };
    });
  }
}
