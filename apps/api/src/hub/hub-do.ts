import {
  ActionIdSchema,
  type Clock,
  type ConfirmChannel,
  ConfirmChannelSchema,
  HalynError,
  type HubRole,
  HubRoleSchema,
  type JsonValue,
  type LedgerEntry,
  LedgerEntrySchema,
  LedgerEntryTypeSchema,
  MoneySchema,
  RequestIdSchema,
  TenantIdSchema,
  type WsMessage,
  WsMessageSchema,
} from '@halyn/shared';
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { type LedgerHead, nextLedgerEntry } from '../ledger';
import { type LedgerSink, tidbLedgerSink } from './ledger-sink';
import { type HubResult, toFailure } from './result';

// One Hub per tenant (ADR-014): the single writer of the tenant's ledger, the idempotency cache, the confirmation
// timers and the WebSocket fan-out. Everything that must happen in order runs through `serial`, because any await
// (crypto, a callback, TiDB) would otherwise let a second request interleave. RPC methods never throw: they return
// a HubResult (result.ts), and the Worker uses them through client.ts.

const FLUSH_DELAY_MS = 250;
const FLUSH_BATCH = 100;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 300_000;
const MAX_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

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

interface PendingRow extends Record<string, SqlStorageValue> {
  request_id: string;
  deadline: number;
}
interface ResultRow extends Record<string, SqlStorageValue> {
  status: string;
  channel: string | null;
}

function failClosed(message: string): never {
  throw new HalynError('E_FAIL_CLOSED', `hub: ${message}`);
}

export class HubDO extends DurableObject<Env> {
  /** Test seam (set through runInDurableObject); production uses the system clock. */
  clock: Clock = systemClock;
  /** Test seam; production persists to TiDB. */
  sink: LedgerSink | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<HubResult<string>>>();

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

  /** One alarm multiplexes the earliest confirmation deadline and the next outbox flush. */
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
    const next = [deadline, flushAt].filter((t): t is number => typeof t === 'number');
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
      const attempts = Number(this.meta('flush_attempts') ?? '0') + 1;
      this.setMeta('flush_attempts', String(attempts));
      this.setMeta(
        'flush_retry_at',
        String(now + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS)),
      );
      console.log(
        JSON.stringify({
          level: 'warn',
          at: new Date(now).toISOString(),
          hub: 'ledger_flush_failed',
          attempts,
          detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
        }),
      );
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

  async startConfirmation(
    tenant_id: string,
    input: StartConfirmation,
  ): Promise<HubResult<{ deadline: string }>> {
    return this.guard(() =>
      this.serial(async () => {
        const tenant = this.bindTenant(tenant_id);
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
        if (
          sql.exec('SELECT 1 FROM confirmation_results WHERE request_id = ?', request_id).toArray().length > 0
        )
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
        return { deadline: expires_at };
      }),
    );
  }

  /** Caller holds the lane. Records the outcome, appends the ledger entry and tells every app. */
  private async settle(
    tenant: string,
    request_id: string,
    status: ConfirmationStatus,
    channel: ConfirmChannel | null,
  ): Promise<void> {
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
  }

  /** First answer wins; any later answer (or one after the timeout) is recorded and ignored. */
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
        const pending = sql
          .exec('SELECT 1 FROM pending_confirmations WHERE request_id = ?', request_id)
          .toArray();
        const record = (accepted: boolean) =>
          sql.exec(
            'INSERT INTO confirmation_answers (request_id, answer, channel, accepted, at) VALUES (?, ?, ?, ?, ?)',
            request_id,
            answer,
            channel,
            accepted ? 1 : 0,
            this.clock.nowMs(),
          );
        if (pending.length > 0) {
          record(true);
          await this.settle(tenant, request_id, answer, channel);
          return { accepted: true, status: answer, channel };
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

  override async alarm(): Promise<void> {
    await this.serial(async () => {
      const tenant = this.meta('tenant');
      if (tenant === null) return;
      const now = this.clock.nowMs();
      const due = this.ctx.storage.sql
        .exec<PendingRow>(
          'SELECT request_id, deadline FROM pending_confirmations WHERE deadline <= ? ORDER BY deadline, request_id',
          now,
        )
        .toArray();
      for (const row of due) await this.settle(tenant, row.request_id, 'timeout', null);
      this.ctx.storage.sql.exec('DELETE FROM idempotency WHERE expires_at <= ?', now);
      const retryAt = this.meta('flush_retry_at');
      if (retryAt === null || Number(retryAt) <= now) await this.flushNow();
    });
    await this.scheduleAlarm();
  }

  // ── WebSockets (Hibernation API) ──────────────────────────────────────────────────────────────

  /** `GET /ws` forwarded by the API Worker after it verified the session; the role becomes the socket's tag. */
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
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role.data]);
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
