import {
  type CompiledPolicyPack,
  CompiledPolicyPackSchema,
  type Handoff,
  HalynError,
  HandoffSchema,
  type TestRun,
  TestRunSchema,
} from '@halyn/shared';
import type { z } from 'zod';
import { type PassCodeRow, PassCodeRowSchema, type PassRow, PassRowSchema } from '../pass';
import {
  type CallState,
  CallStateSchema,
  type CredentialRecord,
  CredentialRecordSchema,
  type DirectoryCustomer,
  DirectoryCustomerSchema,
  type DirectorySnapshot,
  type MirrorItem,
  MirrorItemSchema,
  type RequestRecord,
  RequestRecordSchema,
} from './types';

// The Hub's own tables for the call-time read model (ADR-016), next to the ledger/outbox/confirmation tables hub-do.ts
// creates. Every row is JSON validated on the way in and out; a malformed row fails closed. Callers hold the Hub's
// serial lane for anything that reads-then-writes.

const TABLES = [
  'CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, region TEXT NOT NULL, number_hash TEXT NOT NULL, row TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS customers_number ON customers (region, number_hash)',
  'CREATE TABLE IF NOT EXISTS passes (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, row TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pass_codes (id TEXT PRIMARY KEY, pass_id TEXT NOT NULL, row TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pass_codes_pass ON pass_codes (pass_id)',
  'CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, row TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, customer_id TEXT NOT NULL, request_id TEXT, expires_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS calls (run_id TEXT PRIMARY KEY, call_sid TEXT, number_hash TEXT, started_at INTEGER NOT NULL, row TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS calls_sid ON calls (call_sid)',
  'CREATE INDEX IF NOT EXISTS calls_number ON calls (number_hash, started_at)',
  'CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, idem_key TEXT NOT NULL, customer_id TEXT, created_at INTEGER NOT NULL, row TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS requests_idem ON requests (idem_key, created_at)',
  'CREATE INDEX IF NOT EXISTS requests_customer ON requests (customer_id, created_at)',
  'CREATE TABLE IF NOT EXISTS packs (sha TEXT PRIMARY KEY, pack TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS mirror (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL)',
  // One row per request while it is `executing` (ADR-020): when it started, when the sweep last took it, and the
  // signed grant (compact JWS) once noted. Never mirrored, never returned; deleted when the request is final.
  'CREATE TABLE IF NOT EXISTS executions (request_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, swept_at INTEGER, token TEXT)',
  // One row per request while it is `approved` and not yet claimed by a Worker (beginExecution): the sweep fails it
  // closed if no Worker claims it in time (ADR-020).
  'CREATE TABLE IF NOT EXISTS approvals (request_id TEXT PRIMARY KEY, approved_at INTEGER NOT NULL)',
  // Specialist handoffs (Console Handoffs): the read model the release/block flow works on; TiDB gets a mirror row.
  'CREATE TABLE IF NOT EXISTS handoffs (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, row TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS handoffs_created ON handoffs (created_at)',
  'CREATE INDEX IF NOT EXISTS calls_started ON calls (started_at)',
  'CREATE INDEX IF NOT EXISTS requests_run ON requests (run_id, created_at)',
  'CREATE INDEX IF NOT EXISTS requests_created ON requests (created_at)',
  // Halyn Test runs (Step 15): one row per suite run, its scenario results appended as they arrive.
  'CREATE TABLE IF NOT EXISTS test_runs (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, row TEXT NOT NULL)',
];

/** A request in flight between beginExecution and its final outcome. */
export interface ExecutionRow extends Record<string, SqlStorageValue> {
  request_id: string;
  started_at: number;
  swept_at: number | null;
  token: string | null;
}

function parse<S extends z.ZodType>(schema: S, text: string, what: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HalynError('E_FAIL_CLOSED', `hub: unreadable ${what} row`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', `hub: malformed ${what} row`);
  return parsed.data;
}

function checked<S extends z.ZodType>(schema: S, value: unknown, what: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', `hub: invalid ${what}`);
  return JSON.stringify(parsed.data);
}

interface RowText extends Record<string, SqlStorageValue> {
  row: string;
}

export class HubStore {
  constructor(private readonly sql: SqlStorage) {
    for (const statement of TABLES) sql.exec(statement);
  }

  private rows(query: string, ...binds: SqlStorageValue[]): string[] {
    return this.sql
      .exec<RowText>(query, ...binds)
      .toArray()
      .map((r) => r.row);
  }

  // ── directory (customers, Passes, codes, passkeys) ───────────────────────────────────────────────

  /**
   * Load a snapshot. Customers are replaced (TiDB owns them); Passes, codes and passkeys are only added when the Hub
   * does not have them yet, because after the first load the Hub's copies are the newest (it writes them first).
   */
  loadDirectory(snapshot: DirectorySnapshot): void {
    this.sql.exec('DELETE FROM customers');
    for (const customer of snapshot.customers) this.putCustomer(customer);
    for (const pass of snapshot.passes) if (!this.pass(pass.id)) this.putPass(pass);
    for (const code of snapshot.codes)
      if (this.rows('SELECT row FROM pass_codes WHERE id = ?', code.id).length === 0) this.putCode(code);
    for (const credential of snapshot.credentials)
      if (this.rows('SELECT row FROM credentials WHERE id = ?', credential.id).length === 0)
        this.putCredential(credential);
  }

  putCustomer(customer: DirectoryCustomer): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO customers (id, region, number_hash, row) VALUES (?, ?, ?, ?)',
      customer.id,
      customer.region,
      customer.number_hash,
      checked(DirectoryCustomerSchema, customer, 'customer'),
    );
  }

  customer(id: string): DirectoryCustomer | null {
    const row = this.rows('SELECT row FROM customers WHERE id = ?', id)[0];
    return row ? parse(DirectoryCustomerSchema, row, 'customer') : null;
  }

  customerByNumber(region: string, number_hash: string): DirectoryCustomer | null {
    const row = this.rows(
      'SELECT row FROM customers WHERE region = ? AND number_hash = ?',
      region,
      number_hash,
    )[0];
    return row ? parse(DirectoryCustomerSchema, row, 'customer') : null;
  }

  customers(): DirectoryCustomer[] {
    return this.rows('SELECT row FROM customers ORDER BY id').map((r) =>
      parse(DirectoryCustomerSchema, r, 'customer'),
    );
  }

  putPass(pass: PassRow): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO passes (id, customer_id, row) VALUES (?, ?, ?)',
      pass.id,
      pass.customer_id,
      checked(PassRowSchema, pass, 'Pass'),
    );
  }

  pass(id: string): PassRow | null {
    const row = this.rows('SELECT row FROM passes WHERE id = ?', id)[0];
    return row ? parse(PassRowSchema, row, 'Pass') : null;
  }

  /** Every Pass that lists this calling number. */
  passesForNumber(number: string): PassRow[] {
    return this.rows('SELECT row FROM passes ORDER BY id')
      .map((r) => parse(PassRowSchema, r, 'Pass'))
      .filter((p) => p.assistant_numbers.includes(number));
  }

  /** The customer's Passes, oldest first (the Aero app's list). */
  /** Every Pass of the tenant (Console Passes). */
  allPasses(limit: number): PassRow[] {
    return this.rows('SELECT row FROM passes ORDER BY id DESC LIMIT ?', limit).map((r) =>
      parse(PassRowSchema, r, 'pass'),
    );
  }

  passesOf(customer_id: string): PassRow[] {
    return this.rows('SELECT row FROM passes WHERE customer_id = ? ORDER BY id', customer_id).map((r) =>
      parse(PassRowSchema, r, 'Pass'),
    );
  }

  putCode(code: PassCodeRow): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO pass_codes (id, pass_id, row) VALUES (?, ?, ?)',
      code.id,
      code.pass_id,
      checked(PassCodeRowSchema, code, 'Pass code'),
    );
  }

  codes(pass_id: string): PassCodeRow[] {
    return this.rows('SELECT row FROM pass_codes WHERE pass_id = ? ORDER BY id', pass_id).map((r) =>
      parse(PassCodeRowSchema, r, 'Pass code'),
    );
  }

  code(id: string): PassCodeRow | null {
    const row = this.rows('SELECT row FROM pass_codes WHERE id = ?', id)[0];
    return row ? parse(PassCodeRowSchema, row, 'Pass code') : null;
  }

  putCredential(credential: CredentialRecord): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO credentials (id, customer_id, row) VALUES (?, ?, ?)',
      credential.id,
      credential.customer_id,
      checked(CredentialRecordSchema, credential, 'credential'),
    );
  }

  credential(id: string): CredentialRecord | null {
    const row = this.rows('SELECT row FROM credentials WHERE id = ?', id)[0];
    return row ? parse(CredentialRecordSchema, row, 'credential') : null;
  }

  credentials(customer_id: string): CredentialRecord[] {
    return this.rows('SELECT row FROM credentials WHERE customer_id = ? ORDER BY id', customer_id).map((r) =>
      parse(CredentialRecordSchema, r, 'credential'),
    );
  }

  // ── WebAuthn challenges (single use) ─────────────────────────────────────────────────────────────

  putChallenge(c: {
    challenge: string;
    kind: 'register' | 'approve' | 'pass';
    customer_id: string;
    request_id: string | null;
    expires_at: number;
  }): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO challenges (challenge, kind, customer_id, request_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      c.challenge,
      c.kind,
      c.customer_id,
      c.request_id,
      c.expires_at,
    );
  }

  /** Remove the challenge and say whether it was issued for exactly this purpose and is still fresh. */
  takeChallenge(c: {
    challenge: string;
    kind: 'register' | 'approve' | 'pass';
    customer_id: string;
    request_id: string | null;
    now: number;
  }): boolean {
    const row = this.sql
      .exec<{ kind: string; customer_id: string; request_id: string | null; expires_at: number }>(
        'SELECT kind, customer_id, request_id, expires_at FROM challenges WHERE challenge = ?',
        c.challenge,
      )
      .toArray()[0];
    this.sql.exec('DELETE FROM challenges WHERE challenge = ? OR expires_at <= ?', c.challenge, c.now);
    return (
      row !== undefined &&
      row.kind === c.kind &&
      row.customer_id === c.customer_id &&
      row.request_id === c.request_id &&
      row.expires_at > c.now
    );
  }

  // ── calls ───────────────────────────────────────────────────────────────────────────────────────

  putCall(call: CallState): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO calls (run_id, call_sid, number_hash, started_at, row) VALUES (?, ?, ?, ?, ?)',
      call.run_id,
      call.call_sid,
      call.number_hash,
      call.started_at,
      checked(CallStateSchema, call, 'call'),
    );
  }

  call(run_id: string): CallState | null {
    const row = this.rows('SELECT row FROM calls WHERE run_id = ?', run_id)[0];
    return row ? parse(CallStateSchema, row, 'call') : null;
  }

  runIdForCallSid(call_sid: string): string | null {
    return (
      this.sql
        .exec<{ run_id: string }>(
          'SELECT run_id FROM calls WHERE call_sid = ? ORDER BY started_at DESC LIMIT 1',
          call_sid,
        )
        .toArray()[0]?.run_id ?? null
    );
  }

  /** Newest first (Console Calls). */
  calls(limit: number): CallState[] {
    return this.rows('SELECT row FROM calls ORDER BY started_at DESC, run_id DESC LIMIT ?', limit).map((r) =>
      parse(CallStateSchema, r, 'call'),
    );
  }

  /** Calls from this number since `since` (S_CALL_BURST). */
  callsFromNumberSince(number_hash: string, since: number): number {
    return (
      this.sql
        .exec<{ n: number }>(
          'SELECT COUNT(*) AS n FROM calls WHERE number_hash = ? AND started_at >= ?',
          number_hash,
          since,
        )
        .toArray()[0]?.n ?? 0
    );
  }

  // ── requests ───────────────────────────────────────────────────────────────────────────────────

  putRequest(record: RequestRecord): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO requests (request_id, run_id, idem_key, customer_id, created_at, row) VALUES (?, ?, ?, ?, ?, ?)',
      record.request_id,
      record.run_id,
      record.idem_key,
      record.customer_id,
      record.created_at,
      checked(RequestRecordSchema, record, 'request'),
    );
  }

  request(request_id: string): RequestRecord | null {
    const row = this.rows('SELECT row FROM requests WHERE request_id = ?', request_id)[0];
    return row ? parse(RequestRecordSchema, row, 'request') : null;
  }

  /** Requests with this idempotency key, newest first. */
  requestsByKey(idem_key: string): RequestRecord[] {
    return this.rows(
      'SELECT row FROM requests WHERE idem_key = ? ORDER BY created_at DESC, request_id DESC',
      idem_key,
    ).map((r) => parse(RequestRecordSchema, r, 'request'));
  }

  /** A customer's requests since `since`, oldest first. */
  customerRequests(customer_id: string, since: number, limit = 500): RequestRecord[] {
    return this.rows(
      'SELECT row FROM requests WHERE customer_id = ? AND created_at >= ? ORDER BY created_at, request_id LIMIT ?',
      customer_id,
      since,
      limit,
    ).map((r) => parse(RequestRecordSchema, r, 'request'));
  }

  /** The requests of these calls, oldest first. */
  requestsOfRuns(run_ids: readonly string[]): RequestRecord[] {
    if (run_ids.length === 0) return [];
    return this.rows(
      `SELECT row FROM requests WHERE run_id IN (${run_ids.map(() => '?').join(', ')}) ORDER BY created_at, request_id`,
      ...run_ids,
    ).map((r) => parse(RequestRecordSchema, r, 'request'));
  }

  /** The tenant's newest requests, newest first (Console Signals). */
  recentRequests(limit: number): RequestRecord[] {
    return this.rows('SELECT row FROM requests ORDER BY created_at DESC, request_id DESC LIMIT ?', limit).map(
      (r) => parse(RequestRecordSchema, r, 'request'),
    );
  }

  // ── handoffs ───────────────────────────────────────────────────────────────────────────────────

  putHandoff(handoff: Handoff): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO handoffs (id, request_id, status, created_at, row) VALUES (?, ?, ?, ?, ?)',
      handoff.id,
      handoff.request_id,
      handoff.status,
      Date.parse(handoff.created_at),
      checked(HandoffSchema, handoff, 'handoff'),
    );
  }

  handoff(id: string): Handoff | null {
    const row = this.rows('SELECT row FROM handoffs WHERE id = ?', id)[0];
    return row ? parse(HandoffSchema, row, 'handoff') : null;
  }

  /** Newest first. */
  handoffs(limit: number): Handoff[] {
    return this.rows('SELECT row FROM handoffs ORDER BY created_at DESC, id DESC LIMIT ?', limit).map((r) =>
      parse(HandoffSchema, r, 'handoff'),
    );
  }

  /** A customer's newest requests, newest first. */
  latestRequests(customer_id: string, limit: number): RequestRecord[] {
    return this.rows(
      'SELECT row FROM requests WHERE customer_id = ? ORDER BY created_at DESC, request_id DESC LIMIT ?',
      customer_id,
      limit,
    ).map((r) => parse(RequestRecordSchema, r, 'request'));
  }

  // ── Halyn Test runs ─────────────────────────────────────────────────────────────────────────

  putTestRun(run: TestRun): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO test_runs (id, started_at, row) VALUES (?, ?, ?)',
      run.id,
      Date.parse(run.started_at),
      checked(TestRunSchema, run, 'test_run'),
    );
  }

  testRun(id: string): TestRun | null {
    const row = this.rows('SELECT row FROM test_runs WHERE id = ?', id)[0];
    return row ? parse(TestRunSchema, row, 'test_run') : null;
  }

  /** Runs started at or before `before` (default: any), newest first. */
  testRuns(limit: number, before = Number.MAX_SAFE_INTEGER): TestRun[] {
    return this.rows(
      'SELECT row FROM test_runs WHERE started_at <= ? ORDER BY started_at DESC, id DESC LIMIT ?',
      before,
      limit,
    ).map((r) => parse(TestRunSchema, r, 'test_run'));
  }

  // ── policy packs used by requests (resolveStepUp needs the pack the Gate decided with) ─────────

  putPack(pack: CompiledPolicyPack): void {
    this.sql.exec(
      'INSERT OR IGNORE INTO packs (sha, pack) VALUES (?, ?)',
      pack.source_sha,
      JSON.stringify(pack),
    );
  }

  pack(sha: string): CompiledPolicyPack | null {
    const row = this.sql.exec<{ pack: string }>('SELECT pack FROM packs WHERE sha = ?', sha).toArray()[0];
    return row ? parse(CompiledPolicyPackSchema, row.pack, 'policy pack') : null;
  }

  // ── executions in flight (ADR-020) ───────────────────────────────────────────────────────────────

  startExecution(request_id: string, at: number): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO executions (request_id, started_at, swept_at, token) VALUES (?, ?, NULL, NULL)',
      request_id,
      at,
    );
  }

  execution(request_id: string): ExecutionRow | null {
    return (
      this.sql
        .exec<ExecutionRow>(
          'SELECT request_id, started_at, swept_at, token FROM executions WHERE request_id = ?',
          request_id,
        )
        .toArray()[0] ?? null
    );
  }

  setExecutionToken(request_id: string, token: string): void {
    this.sql.exec('UPDATE executions SET token = ? WHERE request_id = ?', token, request_id);
  }

  markSwept(request_id: string, at: number): void {
    this.sql.exec('UPDATE executions SET swept_at = ? WHERE request_id = ?', at, request_id);
  }

  endExecution(request_id: string): void {
    this.sql.exec('DELETE FROM executions WHERE request_id = ?', request_id);
  }

  /** Executions last started or swept at or before `before`, oldest first, at most `limit`. */
  dueExecutions(before: number, limit: number): ExecutionRow[] {
    return this.sql
      .exec<ExecutionRow>(
        'SELECT request_id, started_at, swept_at, token FROM executions WHERE COALESCE(swept_at, started_at) <= ? ORDER BY COALESCE(swept_at, started_at), request_id LIMIT ?',
        before,
        limit,
      )
      .toArray();
  }

  /** The earliest time an execution was started or last swept (the sweep is due SWEEP_DELAY_MS later). */
  oldestExecution(): number | null {
    return (
      this.sql
        .exec<{ t: number | null }>('SELECT MIN(COALESCE(swept_at, started_at)) AS t FROM executions')
        .toArray()[0]?.t ?? null
    );
  }

  // ── approved, not yet claimed (ADR-020) ──────────────────────────────────────────────────────────

  markApproved(request_id: string, at: number): void {
    this.sql.exec('INSERT OR REPLACE INTO approvals (request_id, approved_at) VALUES (?, ?)', request_id, at);
  }

  clearApproved(request_id: string): void {
    this.sql.exec('DELETE FROM approvals WHERE request_id = ?', request_id);
  }

  /** Requests approved at or before `before` and still unclaimed, oldest first, at most `limit`. */
  dueApprovals(before: number, limit: number): string[] {
    if (limit <= 0) return [];
    return this.sql
      .exec<{ request_id: string }>(
        'SELECT request_id FROM approvals WHERE approved_at <= ? ORDER BY approved_at, request_id LIMIT ?',
        before,
        limit,
      )
      .toArray()
      .map((r) => r.request_id);
  }

  /** When the oldest unclaimed approval was made (the sweep is due SWEEP_DELAY_MS later). */
  oldestApproval(): number | null {
    return (
      this.sql.exec<{ t: number | null }>('SELECT MIN(approved_at) AS t FROM approvals').toArray()[0]?.t ??
      null
    );
  }

  // ── mirror outbox → TiDB ─────────────────────────────────────────────────────────────────────────

  enqueue(item: MirrorItem): void {
    this.sql.exec('INSERT INTO mirror (item) VALUES (?)', checked(MirrorItemSchema, item, 'mirror item'));
  }

  pendingMirror(limit: number): { id: number; item: MirrorItem }[] {
    return this.sql
      .exec<{ id: number; item: string }>('SELECT id, item FROM mirror ORDER BY id LIMIT ?', limit)
      .toArray()
      .map((r) => ({ id: r.id, item: parse(MirrorItemSchema, r.item, 'mirror') }));
  }

  mirrorCount(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM mirror').toArray()[0]?.n ?? 0;
  }

  dropMirror(upToId: number): void {
    this.sql.exec('DELETE FROM mirror WHERE id <= ?', upToId);
  }
}
