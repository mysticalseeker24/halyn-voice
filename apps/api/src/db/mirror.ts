import { HalynError, TenantIdSchema } from '@halyn/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { TiDBServerlessDatabase } from 'drizzle-orm/tidb-serverless';
import { z } from 'zod';
import type { MirrorItem } from '../hub/types';
import { PassRowSchema } from '../pass';
import type * as schema from './schema';
import {
  actionRequests,
  calls,
  confirmations,
  customers,
  decisions,
  grants,
  handoffs,
  passCodes,
  passes,
} from './schema';

// The Hub's mirror outbox → TiDB (ADR-016). Each item kind becomes one idempotent statement scoped to the tenant
// (invariant 8): re-sending an item after a failed flush changes nothing. Times arrive as epoch ms (or ISO strings
// for Pass codes) and are written as DATETIME(3). Builders are returned unawaited so tests can read their SQL offline.

type AnyDb = TiDBServerlessDatabase<typeof schema>;

const Ms = z.int().nonnegative();
const at = (ms: number) => new Date(ms);
const atOrNull = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms));

const CallRow = z.object({
  id: z.string(),
  run_id: z.string(),
  agent: z.string(),
  channel: z.string(),
  from_number_last4: z.string().nullable(),
  started_at: Ms,
  ended_at: Ms.nullable(),
  purpose: z.string().nullable(),
  recording_url: z.string().nullable().optional(),
});
const RequestRow = z.object({
  request: z.object({
    id: z.string(),
    call_id: z.string(),
    run_id: z.string(),
    customer_id: z.string().nullable(),
    action: z.string(),
    params: z.unknown(),
    params_hash: z.string(),
    readback_confirmed: z.boolean(),
    caller_quotes: z.array(z.string()),
    created_at: Ms,
  }),
  decision: z.object({
    id: z.string(),
    request_id: z.string(),
    outcome: z.string(),
    final_outcome: z.string().nullable(),
    tier: z.int().nullable(),
    base_tier: z.int().nullable(),
    reasons: z.array(z.string()),
    signals: z.array(z.string()),
    coaching: z.unknown(),
    decided_at: Ms,
  }),
});
const DecisionRow = z.object({
  request_id: z.string(),
  final_outcome: z.string(),
  reasons: z.array(z.string()),
});
const GrantRow = z.object({
  jti: z.string(),
  request_id: z.string(),
  params_hash: z.string().optional(),
  issued_at: Ms.optional(),
  expires_at: Ms.optional(),
  used_at: Ms.nullable().optional(),
});
const ConfirmationRow = z.object({
  id: z.string(),
  request_id: z.string(),
  channel: z.string(),
  status: z.string(),
  answer: z.string().nullable(),
  bolna_execution_id: z.string().nullable(),
  answered_at: Ms.nullable(),
});
const HandoffRow = z.object({
  id: z.string(),
  request_id: z.string(),
  call_id: z.string().nullable(),
  reason: z.string(),
  status: z.string(),
  note: z.string().nullable().optional(),
  created_at: Ms,
  resolved_at: Ms.nullable().optional(),
});
const PassUpdate = z.object({ id: z.string(), failures: z.int().nonnegative(), status: z.string() });
const PassCodeRow = z.object({
  id: z.string(),
  pass_id: z.string(),
  code_hash: z.string(),
  bound_number: z.string(),
  expires_at: z.iso.datetime(),
  used_at: z.iso.datetime().nullable(),
});
const CredentialsRow = z.object({ customer_id: z.string(), credentials: z.array(z.unknown()) });

function fail(kind: string): never {
  throw new HalynError('E_FAIL_CLOSED', `mirror: malformed ${kind} item`);
}

function read<S extends z.ZodType>(schema: S, item: MirrorItem): z.infer<S> {
  const parsed = schema.safeParse(item.row);
  return parsed.success ? parsed.data : fail(item.kind);
}

/** One statement per item, tenant-scoped. */
export function mirrorStatement(db: AnyDb, tenant_id: string, item: MirrorItem) {
  if (!TenantIdSchema.safeParse(tenant_id).success)
    throw new HalynError('E_FAIL_CLOSED', 'mirror: bad tenant');
  const t = tenant_id;
  switch (item.kind) {
    case 'call': {
      const r = read(CallRow, item);
      const row = {
        id: r.id,
        tenant_id: t,
        run_id: r.run_id,
        agent: r.agent,
        channel: r.channel,
        from_number_last4: r.from_number_last4,
        started_at: at(r.started_at),
        ended_at: atOrNull(r.ended_at),
        purpose: r.purpose,
        recording_url: r.recording_url ?? null,
      };
      return db
        .insert(calls)
        .values(row)
        .onDuplicateKeyUpdate({
          set: {
            ended_at: row.ended_at,
            purpose: row.purpose,
            recording_url: sql`COALESCE(VALUES(recording_url), recording_url)`,
          },
        });
    }
    case 'request': {
      const { request: q, decision: d } = read(RequestRow, item);
      return [
        db
          .insert(actionRequests)
          .ignore()
          .values({
            id: q.id,
            tenant_id: t,
            call_id: q.call_id,
            run_id: q.run_id,
            customer_id: q.customer_id,
            action: q.action,
            params: q.params,
            params_hash: q.params_hash,
            readback_confirmed: q.readback_confirmed,
            caller_quotes: q.caller_quotes,
            created_at: at(q.created_at),
          }),
        db
          .insert(decisions)
          .ignore()
          .values({
            id: d.id,
            tenant_id: t,
            request_id: d.request_id,
            outcome: d.outcome,
            final_outcome: d.final_outcome,
            tier: d.tier,
            base_tier: d.base_tier,
            reasons: d.reasons,
            signals: d.signals,
            coaching: d.coaching,
            decided_at: at(d.decided_at),
          }),
      ];
    }
    case 'decision': {
      const r = read(DecisionRow, item);
      return db
        .update(decisions)
        .set({ final_outcome: r.final_outcome, reasons: r.reasons })
        .where(and(eq(decisions.tenant_id, t), eq(decisions.request_id, r.request_id)));
    }
    case 'grant': {
      const r = read(GrantRow, item);
      if (r.params_hash === undefined || r.issued_at === undefined || r.expires_at === undefined)
        return db
          .update(grants)
          .set({ used_at: atOrNull(r.used_at) })
          .where(and(eq(grants.tenant_id, t), eq(grants.jti, r.jti)));
      return db
        .insert(grants)
        .ignore()
        .values({
          jti: r.jti,
          tenant_id: t,
          request_id: r.request_id,
          params_hash: r.params_hash,
          issued_at: at(r.issued_at),
          expires_at: at(r.expires_at),
          used_at: atOrNull(r.used_at),
        });
    }
    case 'confirmation': {
      const r = read(ConfirmationRow, item);
      return db
        .insert(confirmations)
        .values({
          id: r.id,
          tenant_id: t,
          request_id: r.request_id,
          channel: r.channel,
          status: r.status,
          answer: r.answer,
          bolna_execution_id: r.bolna_execution_id,
          answered_at: atOrNull(r.answered_at),
        })
        .onDuplicateKeyUpdate({
          set: {
            status: r.status,
            answer: r.answer,
            bolna_execution_id: r.bolna_execution_id,
            answered_at: atOrNull(r.answered_at),
          },
        });
    }
    case 'handoff': {
      const r = read(HandoffRow, item);
      // Opened, then resolved once (release/block): the resolution updates the same row.
      return db
        .insert(handoffs)
        .values({
          id: r.id,
          tenant_id: t,
          request_id: r.request_id,
          call_id: r.call_id,
          reason: r.reason,
          status: r.status,
          note: r.note ?? null,
          created_at: at(r.created_at),
          resolved_at: atOrNull(r.resolved_at),
        })
        .onDuplicateKeyUpdate({
          set: { status: r.status, note: r.note ?? null, resolved_at: atOrNull(r.resolved_at) },
        });
    }
    case 'pass': {
      const r = read(PassUpdate, item);
      return db
        .update(passes)
        .set({ failures: r.failures, status: r.status })
        .where(and(eq(passes.tenant_id, t), eq(passes.id, r.id)));
    }
    case 'pass_row': {
      // A Pass issued or revoked in the Hub: the whole row, idempotent.
      const r = read(PassRowSchema, item);
      const revoked_at = r.revoked_at === null ? null : new Date(r.revoked_at);
      return db
        .insert(passes)
        .values({
          id: r.id,
          tenant_id: t,
          customer_id: r.customer_id,
          assistant_name: r.assistant_name,
          assistant_numbers: r.assistant_numbers,
          scopes: r.scopes,
          issued_at: new Date(r.issued_at),
          expires_at: new Date(r.expires_at),
          status: r.status,
          customer_sig: r.customer_sig,
          issuer_sig: r.issuer_sig,
          failures: r.failures,
          revoked_at,
        })
        .onDuplicateKeyUpdate({ set: { status: r.status, failures: r.failures, revoked_at } });
    }
    case 'pass_code': {
      const r = read(PassCodeRow, item);
      const used_at = r.used_at === null ? null : new Date(r.used_at);
      return db
        .insert(passCodes)
        .values({
          id: r.id,
          tenant_id: t,
          pass_id: r.pass_id,
          code_hash: r.code_hash,
          bound_number: r.bound_number,
          expires_at: new Date(r.expires_at),
          used_at,
        })
        .onDuplicateKeyUpdate({ set: { used_at } });
    }
    case 'credentials': {
      const r = read(CredentialsRow, item);
      return db
        .update(customers)
        .set({ passkey_credential: r.credentials })
        .where(and(eq(customers.tenant_id, t), eq(customers.id, r.customer_id)));
    }
  }
}
