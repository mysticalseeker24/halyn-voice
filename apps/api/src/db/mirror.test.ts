import { HalynError } from '@halyn/shared';
import { drizzle } from 'drizzle-orm/tidb-serverless';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { TEST_PASS_ROW } from '../../test/fixtures/db';
import { snapshotFromRows, tidbDirectorySource, tidbMirrorSink } from '../hub/ports';
import type { MirrorItem } from '../hub/types';
import { mirrorStatement } from './mirror';
import * as schema from './schema';

// The Hub's mirror outbox → TiDB, offline: every item kind becomes tenant-scoped SQL (invariant 8), and the
// directory load maps TiDB rows back into the Hub's snapshot. The live round trip is the gated DB suite (ADR-013).

const db = drizzle.mock({ schema });
const T = 'ten_aero';
const H = 'b'.repeat(64);
const AT = 1793000000000;

const ITEMS: MirrorItem[] = [
  {
    kind: 'call',
    row: {
      id: 'call_1',
      run_id: 'run',
      agent: 'aero',
      channel: 'phone',
      from_number_last4: '0003',
      started_at: AT,
      ended_at: null,
      purpose: null,
    },
  },
  {
    kind: 'request',
    row: {
      request: {
        id: 'req_1',
        call_id: 'call_1',
        run_id: 'run',
        customer_id: 'cus_saksham',
        action: 'card.freeze',
        params: { card_last4: '8812' },
        params_hash: H,
        readback_confirmed: true,
        caller_quotes: [],
        created_at: AT,
      },
      decision: {
        id: 'dec_1',
        request_id: 'req_1',
        outcome: 'allow',
        final_outcome: null,
        tier: 0,
        base_tier: 0,
        reasons: ['P_PROTECTIVE'],
        signals: [],
        coaching: { score: 0, cues: [] },
        decided_at: AT,
      },
    },
  },
  { kind: 'decision', row: { request_id: 'req_1', final_outcome: 'deny', reasons: ['C_DECLINED'] } },
  {
    kind: 'grant',
    row: {
      jti: '01J00000000000000000000000',
      request_id: 'req_1',
      params_hash: H,
      issued_at: AT,
      expires_at: AT + 60000,
      used_at: null,
    },
  },
  { kind: 'grant', row: { jti: '01J00000000000000000000000', request_id: 'req_1', used_at: AT } },
  {
    kind: 'confirmation',
    row: {
      id: 'cnf_1',
      request_id: 'req_1',
      channel: 'callback',
      status: 'pending',
      answer: null,
      bolna_execution_id: 'x',
      answered_at: null,
    },
  },
  {
    kind: 'handoff',
    row: {
      id: 'ho_1',
      request_id: 'req_1',
      call_id: 'call_1',
      reason: 'S_COACHING',
      status: 'open',
      created_at: AT,
    },
  },
  { kind: 'pass', row: { id: 'pass_demo', failures: 5, status: 'locked' } },
  {
    kind: 'pass_code',
    row: {
      id: 'pcode_1',
      pass_id: 'pass_demo',
      code_hash: H,
      bound_number: '+918065356379',
      expires_at: '2026-10-28T05:05:00.000Z',
      used_at: null,
    },
  },
  { kind: 'credentials', row: { customer_id: 'cus_saksham', credentials: [] } },
];

describe('mirrorStatement', () => {
  it.each(ITEMS.map((item) => [item.kind, item] as const))('%s is tenant-scoped SQL', (_, item) => {
    const built = mirrorStatement(db as never, T, item);
    for (const statement of Array.isArray(built) ? built : [built]) {
      const { sql, params } = (statement as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
      expect(sql).toMatch(/tenant_id/);
      expect(params).toContain(T);
    }
  });

  it('refuses a malformed item or tenant', () => {
    expect(() => mirrorStatement(db as never, T, { kind: 'call', row: { id: 1 } })).toThrow(HalynError);
    expect(() => mirrorStatement(db as never, 'nope', ITEMS[0]!)).toThrow(HalynError);
  });
});

describe('the TiDB ports fail closed without a database', () => {
  it('directory load and mirror flush throw, so the Hub keeps its outbox and retries', async () => {
    await expect(tidbDirectorySource({}).load(T, AT)).rejects.toThrow(HalynError);
    await expect(tidbMirrorSink({}).persist(T, ITEMS)).rejects.toThrow(HalynError);
    expect(env).toBeDefined();
  });
});

describe('snapshotFromRows', () => {
  const customer = {
    id: 'cus_saksham',
    tenant_id: T,
    name: 'Saksham Mishra',
    spoken_name: 'सक्षम',
    region: 'IN',
    language: 'hi',
    registered_number_hash: H,
    registered_number_last4: '0003',
    passkey_credential: JSON.stringify([
      { id: 'Y3JlZA', alg: -7, jwk: { kty: 'EC' }, sign_count: 0, created_at: '2026-10-28T05:00:00.000Z' },
      { id: 'bad', alg: -35 },
    ]),
    created_at: new Date(AT),
  };
  const pass = {
    ...TEST_PASS_ROW,
    assistant_numbers: JSON.stringify(TEST_PASS_ROW.assistant_numbers),
    scopes: TEST_PASS_ROW.scopes,
    issued_at: new Date(TEST_PASS_ROW.issued_at),
    expires_at: new Date(TEST_PASS_ROW.expires_at),
    revoked_at: null,
  };
  const code = {
    id: 'pcode_1',
    tenant_id: T,
    pass_id: TEST_PASS_ROW.id,
    code_hash: H,
    bound_number: '+918065356379',
    expires_at: new Date(AT),
    used_at: null,
  };

  it('maps customers (spoken name), Passes (JSON columns), codes and passkeys', () => {
    const snapshot = snapshotFromRows([customer], [pass], [code]);
    expect(snapshot.customers).toEqual([
      {
        id: 'cus_saksham',
        name: 'Saksham Mishra',
        spoken_name: 'सक्षम',
        region: 'IN',
        language: 'hi',
        number_hash: H,
        last4: '0003',
      },
    ]);
    expect(snapshot.passes[0]?.assistant_numbers).toEqual(TEST_PASS_ROW.assistant_numbers);
    expect(snapshot.codes[0]?.expires_at).toBe(new Date(AT).toISOString());
    expect(snapshot.credentials.map((c) => c.id)).toEqual(['Y3JlZA']);
  });

  it('a customer without a spoken name falls back to the name; unreadable passkeys are dropped', () => {
    const snapshot = snapshotFromRows(
      [{ ...customer, spoken_name: null, passkey_credential: 'not json' }],
      [],
      [],
    );
    expect(snapshot.customers[0]?.spoken_name).toBe('Saksham Mishra');
    expect(snapshot.credentials).toEqual([]);
  });

  it('malformed rows fail closed', () => {
    expect(() => snapshotFromRows([{ ...customer, region: 'XX' }], [], [])).toThrow(HalynError);
  });
});
