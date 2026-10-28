import {
  HalynError,
  LedgerListResponseSchema,
  LedgerVerifyResponseSchema,
  verifyLedgerChain,
} from '@halyn/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../http/app-env';
import { hubFor } from '../hub/client';

// The ledger for the Stage and the Console (console sessions): the newest entries and an anchored verify (ADR-012).
// Both read the Hub's own copy, which is the ordering authority (ADR-014); the TiDB copy may lag by one flush.

const MAX_VERIFY = 5000;

function console_(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (session.kind !== 'console') throw new HalynError('E_UNAUTHORIZED', 'A console session is required');
  return session.tenant_id;
}

/** GET /web/ledger?limit=N → the newest N entries (default 50, at most 500), oldest first, and the chain head. */
export async function ledgerList(c: Context<AppEnv>): Promise<Response> {
  const tenant = console_(c);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .catch(50)
    .parse(c.req.query('limit') ?? 50);
  const hub = hubFor(c.env, tenant);
  const head = await hub.ledgerHead();
  const entries = head ? await hub.ledgerEntries(Math.max(1, head.seq - limit + 1), limit) : [];
  return c.json(LedgerListResponseSchema.parse({ entries, head_hash: head?.hash ?? null }));
}

/**
 * GET /web/ledger/verify → recomputes the chain from seq 1 against the Hub's head anchor, so an edited, re-hashed or
 * cut-off copy is caught (invariant 6). Bounded at 5,000 entries per request (the free Workers CPU budget, ADR-012);
 * above that the Console verifies in the browser with @halyn/sdk.
 */
export async function ledgerVerify(c: Context<AppEnv>): Promise<Response> {
  const tenant = console_(c);
  const hub = hubFor(c.env, tenant);
  const head = await hub.ledgerHead();
  if (head && head.seq > MAX_VERIFY)
    throw new HalynError('E_BAD_REQUEST', 'The ledger is too long to verify here; verify it with @halyn/sdk');
  const entries = head ? await hub.ledgerEntries(1, MAX_VERIFY) : [];
  return c.json(
    LedgerVerifyResponseSchema.parse(await verifyLedgerChain(entries, head ? { anchor: head } : {})),
  );
}
