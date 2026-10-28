import {
  bigint,
  boolean,
  char,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

// TiDB (MySQL dialect), docs/DATA_MODEL.md. Every table carries tenant_id and leads its primary key with it, so a
// row is only ever addressed inside its tenant (invariant 8). Ids are `<prefix>_<ULID>` (ADR-009). Times are UTC
// DATETIME(3); money is BIGINT minor units + CHAR(3). The ledger keeps created_at as the exact ISO string it hashed.

const id = (name = 'id') => varchar(name, { length: 64 }).notNull();
const tenantId = () => varchar('tenant_id', { length: 64 }).notNull();
const at = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const sha256 = (name: string) => char(name, { length: 64 }).notNull();

export const tenants = mysqlTable('tenants', {
  id: id().primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  default_region: char('default_region', { length: 2 }).notNull(),
  signing_key_id: varchar('signing_key_id', { length: 64 }).notNull(),
  created_at: at('created_at').notNull(),
});

export const customers = mysqlTable(
  'customers',
  {
    id: id(),
    tenant_id: tenantId(),
    name: varchar('name', { length: 80 }).notNull(),
    /** What voices say (TTS): Saksham is written सक्षम (CLAUDE.md §8). Screens use `name`. */
    spoken_name: varchar('spoken_name', { length: 80 }),
    region: char('region', { length: 2 }).notNull(),
    language: varchar('language', { length: 8 }).notNull(),
    /** SHA-256(PHONE_HASH_PEPPER ‖ E.164): the full number is never stored. */
    registered_number_hash: sha256('registered_number_hash'),
    registered_number_last4: char('registered_number_last4', { length: 4 }).notNull(),
    passkey_credential: json('passkey_credential'),
    created_at: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    // One customer per number per region: the IN customer and the US twin share Saksham's number.
    uniqueIndex('customers_number').on(t.tenant_id, t.region, t.registered_number_hash),
  ],
);

export const policyPacks = mysqlTable(
  'policy_packs',
  {
    id: id(),
    tenant_id: tenantId(),
    region: char('region', { length: 2 }).notNull(),
    version: int('version').notNull(),
    compiled_json: json('compiled_json').notNull(),
    source_sha: sha256('source_sha'),
    created_at: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    uniqueIndex('policy_packs_region_version').on(t.tenant_id, t.region, t.version),
  ],
);

export const passes = mysqlTable(
  'passes',
  {
    id: id(),
    tenant_id: tenantId(),
    customer_id: id('customer_id'),
    assistant_name: varchar('assistant_name', { length: 80 }).notNull(),
    assistant_numbers: json('assistant_numbers').notNull(),
    scopes: json('scopes').notNull(),
    issued_at: at('issued_at').notNull(),
    expires_at: at('expires_at').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    customer_sig: text('customer_sig').notNull(),
    issuer_sig: text('issuer_sig').notNull(),
    failures: int('failures').notNull().default(0),
    revoked_at: at('revoked_at'),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    index('passes_customer').on(t.tenant_id, t.customer_id),
  ],
);

export const passCodes = mysqlTable(
  'pass_codes',
  {
    id: id(),
    tenant_id: tenantId(),
    pass_id: id('pass_id'),
    /** SHA-256(PASS_CODE_PEPPER ‖ code): the code itself is never stored. */
    code_hash: sha256('code_hash'),
    bound_number: varchar('bound_number', { length: 16 }).notNull(),
    expires_at: at('expires_at').notNull(),
    used_at: at('used_at'),
  },
  (t) => [primaryKey({ columns: [t.tenant_id, t.id] }), index('pass_codes_pass').on(t.tenant_id, t.pass_id)],
);

export const calls = mysqlTable(
  'calls',
  {
    id: id(),
    tenant_id: tenantId(),
    bolna_execution_id: varchar('bolna_execution_id', { length: 128 }),
    run_id: varchar('run_id', { length: 128 }).notNull(),
    agent: varchar('agent', { length: 32 }).notNull(),
    channel: varchar('channel', { length: 8 }).notNull(),
    from_number_last4: char('from_number_last4', { length: 4 }),
    started_at: at('started_at').notNull(),
    ended_at: at('ended_at'),
    transcript_ref: varchar('transcript_ref', { length: 255 }),
    recording_url: varchar('recording_url', { length: 512 }),
    /** `security_demo` for scenarios 3 and 4 (docs/COMPLIANCE.md). */
    purpose: varchar('purpose', { length: 32 }),
  },
  (t) => [primaryKey({ columns: [t.tenant_id, t.id] }), uniqueIndex('calls_run').on(t.tenant_id, t.run_id)],
);

export const actionRequests = mysqlTable(
  'action_requests',
  {
    id: id(),
    tenant_id: tenantId(),
    call_id: varchar('call_id', { length: 64 }),
    run_id: varchar('run_id', { length: 128 }).notNull(),
    customer_id: varchar('customer_id', { length: 64 }),
    action: varchar('action', { length: 48 }).notNull(),
    params: json('params').notNull(),
    params_hash: sha256('params_hash'),
    readback_confirmed: boolean('readback_confirmed').notNull(),
    caller_quotes: json('caller_quotes').notNull(),
    created_at: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    // Invariant 7: the same (run_id, params_hash) is one request for the whole call; the Hub answers a retry with it.
    uniqueIndex('action_requests_idempotency').on(t.tenant_id, t.run_id, t.params_hash),
  ],
);

export const decisions = mysqlTable(
  'decisions',
  {
    id: id(),
    tenant_id: tenantId(),
    request_id: id('request_id'),
    outcome: varchar('outcome', { length: 8 }).notNull(),
    final_outcome: varchar('final_outcome', { length: 8 }),
    tier: int('tier'),
    base_tier: int('base_tier'),
    reasons: json('reasons').notNull(),
    signals: json('signals').notNull(),
    coaching: json('coaching').notNull(),
    decided_at: at('decided_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    uniqueIndex('decisions_request').on(t.tenant_id, t.request_id),
  ],
);

export const grants = mysqlTable(
  'grants',
  {
    jti: char('jti', { length: 26 }).notNull(),
    tenant_id: tenantId(),
    request_id: id('request_id'),
    params_hash: sha256('params_hash'),
    issued_at: at('issued_at').notNull(),
    expires_at: at('expires_at').notNull(),
    used_at: at('used_at'),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.jti] }),
    index('grants_request').on(t.tenant_id, t.request_id),
  ],
);

export const confirmations = mysqlTable(
  'confirmations',
  {
    id: id(),
    tenant_id: tenantId(),
    request_id: id('request_id'),
    channel: varchar('channel', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    answer: varchar('answer', { length: 16 }),
    bolna_execution_id: varchar('bolna_execution_id', { length: 128 }),
    answered_at: at('answered_at'),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    index('confirmations_request').on(t.tenant_id, t.request_id),
  ],
);

export const handoffs = mysqlTable(
  'handoffs',
  {
    id: id(),
    tenant_id: tenantId(),
    request_id: id('request_id'),
    call_id: varchar('call_id', { length: 64 }),
    reason: varchar('reason', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    note: text('note'),
    created_at: at('created_at').notNull(),
    resolved_at: at('resolved_at'),
  },
  (t) => [primaryKey({ columns: [t.tenant_id, t.id] }), index('handoffs_status').on(t.tenant_id, t.status)],
);

export const ledgerEntries = mysqlTable(
  'ledger_entries',
  {
    seq: bigint('seq', { mode: 'number' }).notNull(),
    tenant_id: tenantId(),
    type: varchar('type', { length: 32 }).notNull(),
    ref_id: varchar('ref_id', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    prev_hash: sha256('prev_hash'),
    hash: sha256('hash'),
    /** The exact ISO string inside the hash (a DATETIME round trip could change it). */
    created_at: varchar('created_at', { length: 30 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenant_id, t.seq] })],
);

export const testRuns = mysqlTable(
  'test_runs',
  {
    id: id(),
    tenant_id: tenantId(),
    suite: varchar('suite', { length: 32 }).notNull(),
    mode: varchar('mode', { length: 8 }).notNull(),
    agent_version: varchar('agent_version', { length: 64 }),
    started_at: at('started_at').notNull(),
    finished_at: at('finished_at'),
    summary: json('summary'),
  },
  (t) => [primaryKey({ columns: [t.tenant_id, t.id] })],
);

export const testResults = mysqlTable(
  'test_results',
  {
    id: id(),
    tenant_id: tenantId(),
    run_id: id('run_id'),
    scenario_id: varchar('scenario_id', { length: 4 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).notNull(),
    expected: varchar('expected', { length: 16 }).notNull(),
    passed: boolean('passed').notNull(),
    metrics: json('metrics'),
    evidence_ref: varchar('evidence_ref', { length: 255 }),
  },
  (t) => [primaryKey({ columns: [t.tenant_id, t.id] }), index('test_results_run').on(t.tenant_id, t.run_id)],
);

/** Every table, for migrations, the tenant-column check and test clean-up. */
export const TABLES = {
  tenants,
  customers,
  policy_packs: policyPacks,
  passes,
  pass_codes: passCodes,
  calls,
  action_requests: actionRequests,
  decisions,
  grants,
  confirmations,
  handoffs,
  ledger_entries: ledgerEntries,
  test_runs: testRuns,
  test_results: testResults,
} as const;
