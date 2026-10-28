import { HalynError, WebAuthnAlgorithmSchema } from '@halyn/shared';
import { z } from 'zod';
import { createDb } from '../db/client';
import { mirrorStatement } from '../db/mirror';
import { selectCustomers, selectLivePassCodes, selectPasses } from '../db/queries';
import type { customers, passCodes, passes } from '../db/schema';
import { DbEnvSchema, requireEnv } from '../env';
import { PassCodeRowSchema, PassRowSchema } from '../pass';
import {
  type CredentialRecord,
  CredentialRecordSchema,
  type DirectorySnapshot,
  DirectorySnapshotSchema,
  type MirrorItem,
} from './types';

// The Hub's two TiDB ports (ADR-016), besides the ledger sink (ledger-sink.ts): where it loads its directory from
// the first time, and where its mirror outbox lands. Tests set fakes on the Durable Object (runInDurableObject).

export interface DirectorySource {
  load(tenant_id: string, nowMs: number): Promise<DirectorySnapshot>;
}

export interface MirrorSink {
  /** Persist items of one tenant in order. Each must be idempotent (the outbox retries after a failure). */
  persist(tenant_id: string, items: readonly MirrorItem[]): Promise<void>;
}

/** A JSON column: the driver may hand it over parsed or as text. Unreadable text stays a string (and fails later). */
const JsonColumn = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}, z.unknown());
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

function credentialsOf(customer_id: string, raw: unknown): CredentialRecord[] {
  const list = JsonColumn.safeParse(raw);
  if (!list.success || !Array.isArray(list.data)) return [];
  return list.data
    .map((c) => CredentialRecordSchema.safeParse({ ...(c as object), customer_id }))
    .filter((r) => r.success && WebAuthnAlgorithmSchema.safeParse(r.data.alg).success)
    .map((r) => r.data as CredentialRecord);
}

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

/** TiDB rows → the Hub's directory snapshot (JSON columns may arrive as strings). Fails closed on anything odd. */
export function snapshotFromRows(
  customerRows: readonly Row<typeof customers>[],
  passRows: readonly Row<typeof passes>[],
  codeRows: readonly Row<typeof passCodes>[],
): DirectorySnapshot {
  const snapshot = {
    customers: customerRows.map((c) => ({
      id: c.id,
      name: c.name,
      // Seeded rows carry the spoken form; an older row falls back to the name (re-run pnpm seed).
      spoken_name: c.spoken_name ?? c.name,
      region: c.region,
      language: c.language,
      number_hash: c.registered_number_hash,
      last4: c.registered_number_last4,
    })),
    passes: passRows.map((p) =>
      PassRowSchema.parse({
        id: p.id,
        tenant_id: p.tenant_id,
        customer_id: p.customer_id,
        assistant_name: p.assistant_name,
        status: p.status,
        customer_sig: p.customer_sig,
        issuer_sig: p.issuer_sig,
        failures: p.failures,
        assistant_numbers: JsonColumn.parse(p.assistant_numbers),
        scopes: JsonColumn.parse(p.scopes),
        issued_at: iso(p.issued_at),
        expires_at: iso(p.expires_at),
        revoked_at: iso(p.revoked_at),
      }),
    ),
    codes: codeRows.map((c) =>
      PassCodeRowSchema.parse({
        id: c.id,
        pass_id: c.pass_id,
        code_hash: c.code_hash,
        bound_number: c.bound_number,
        expires_at: iso(c.expires_at),
        used_at: iso(c.used_at),
      }),
    ),
    credentials: customerRows.flatMap((c) => credentialsOf(c.id, c.passkey_credential)),
  };
  const parsed = DirectorySnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', 'hub: TiDB directory rows are malformed');
  return parsed.data;
}

export function tidbDirectorySource(env: unknown): DirectorySource {
  return {
    async load(tenant_id, nowMs) {
      const { TIDB_DATABASE_URL } = requireEnv(env, DbEnvSchema);
      const db = createDb(TIDB_DATABASE_URL);
      const [customerRows, passRows, codeRows] = await Promise.all([
        selectCustomers(db, tenant_id),
        selectPasses(db, tenant_id),
        selectLivePassCodes(db, tenant_id, new Date(nowMs)),
      ]);
      return snapshotFromRows(customerRows, passRows, codeRows);
    },
  };
}

export function tidbMirrorSink(env: unknown): MirrorSink {
  return {
    async persist(tenant_id, items) {
      const { TIDB_DATABASE_URL } = requireEnv(env, DbEnvSchema);
      const db = createDb(TIDB_DATABASE_URL);
      for (const item of items) {
        const statement = mirrorStatement(db, tenant_id, item);
        // A request and its decision are one row pair: written in one transaction (CLAUDE.md §6).
        if (Array.isArray(statement))
          await db.transaction(async (tx) => {
            const inTx = mirrorStatement(tx as unknown as typeof db, tenant_id, item) as unknown[];
            for (const s of inTx) await s;
          });
        else await statement;
      }
    },
  };
}
