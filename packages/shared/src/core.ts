import { z } from 'zod';
import { ACTION_IDS, type ActionId, AccountTypeSchema } from './actions';
import { IdSchema, IsoDateTimeSchema, Last4Schema } from './ids';
import { CurrencySchema, PositiveMoneySchema } from './money';

// Aero Core, the mock bank (apps/aero-core): which route executes each action, and what it answers. The API's core
// client (Step 7) and Aero Core both read this, and docs/ACTIONS.md's "Aero Core" column is contract-tested against it.
// GET routes take the action's params as the query string, POST routes as the JSON body; either way the params are
// exactly what the grant's params_hash covers, and the route acts only on the accounts of the grant's `sub`.

export interface CoreRoute {
  method: 'GET' | 'POST';
  path: string;
}

export const CORE_ROUTES = {
  'balance.view': { method: 'GET', path: '/core/balance' },
  'card.freeze': { method: 'POST', path: '/core/cards/freeze' },
  'emi.move_date': { method: 'POST', path: '/core/loans/emi-date' },
  'fee.waive': { method: 'POST', path: '/core/fees/waive' },
  'statement.view': { method: 'GET', path: '/core/statement' },
  'transfer.new_payee': { method: 'POST', path: '/core/transfers' },
  'transfer.saved': { method: 'POST', path: '/core/transfers' },
  'wire.new': { method: 'POST', path: '/core/transfers' },
} as const satisfies Partial<Record<ActionId, CoreRoute>>;

export type CoreActionId = keyof typeof CORE_ROUTES;

export function isCoreAction(value: string): value is CoreActionId {
  return Object.hasOwn(CORE_ROUTES, value);
}

/** The actions Aero Core executes, in ActionId order. */
export const CORE_ACTION_IDS: readonly CoreActionId[] = ACTION_IDS.filter(isCoreAction);

/** The route for an action, or null when Aero Core has none (the four agent-tier actions, human-only actions). */
export function coreRoute(action: ActionId): CoreRoute | null {
  return isCoreAction(action) ? CORE_ROUTES[action] : null;
}

export interface CoreEndpoint extends CoreRoute {
  /** Every action this route executes; the grant's (verified) action picks one. */
  actions: CoreActionId[];
}

/** One entry per route, in first-action order: `POST /core/transfers` serves three actions. */
export function coreEndpoints(): CoreEndpoint[] {
  const byRoute = new Map<string, CoreEndpoint>();
  for (const action of CORE_ACTION_IDS) {
    const { method, path } = CORE_ROUTES[action];
    const key = `${method} ${path}`;
    const endpoint = byRoute.get(key);
    if (endpoint) endpoint.actions.push(action);
    else byRoute.set(key, { method, path, actions: [action] });
  }
  return [...byRoute.values()];
}

// ── Responses (200). Errors use the standard envelope with E_GRANT_* / E_PARAMS_MISMATCH (401), E_BAD_REQUEST (400),
// E_NOT_FOUND (404) or E_FAIL_CLOSED (500). ─────────────────────────────────────────────────────────────────────────

/** A speakable reference for a write: `AERO-` + 6 Crockford base32 characters (no I, L, O, U). */
export const CoreReferenceSchema = z.string().regex(/^AERO-[0-9A-HJKMNP-TV-Z]{6}$/, 'expected AERO-XXXXXX');

/** A balance: integer minor units, never negative (Aero Core refuses any write that would overdraw). */
export const CoreBalanceSchema = z.strictObject({
  amount_minor: z.int().nonnegative(),
  currency: CurrencySchema,
});

export const CORE_TRANSACTION_CATEGORIES = [
  'salary',
  'card',
  'fee',
  'fee_waiver',
  'emi',
  'transfer',
  'wire',
] as const;

/** A statement line. Payees appear by id; no account or card numbers. */
export const CoreTransactionSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(['credit', 'debit']),
  category: z.enum(CORE_TRANSACTION_CATEGORIES),
  amount: PositiveMoneySchema,
  description: z.string().min(1).max(120),
  payee_id: IdSchema.nullable(),
  reference: z.string().min(1).max(64).nullable(),
  created_at: IsoDateTimeSchema,
});
export type CoreTransaction = z.infer<typeof CoreTransactionSchema>;

const EmiDaySchema = z.int().min(1).max(28);

const transferResponse = <A extends 'transfer.new_payee' | 'transfer.saved' | 'wire.new'>(action: A) =>
  z.strictObject({
    action: z.literal(action),
    reference: CoreReferenceSchema,
    transaction: CoreTransactionSchema,
    balance: CoreBalanceSchema,
  });

export const CORE_RESPONSES = {
  'balance.view': z.strictObject({
    action: z.literal('balance.view'),
    account: AccountTypeSchema,
    balance: CoreBalanceSchema,
    as_of: IsoDateTimeSchema,
  }),
  'card.freeze': z.strictObject({
    action: z.literal('card.freeze'),
    reference: CoreReferenceSchema,
    card: z.strictObject({ last4: Last4Schema, status: z.literal('frozen') }),
    /** True when the card was already frozen; freezing is idempotent. */
    already_frozen: z.boolean(),
  }),
  'emi.move_date': z.strictObject({
    action: z.literal('emi.move_date'),
    reference: CoreReferenceSchema,
    loan: z.strictObject({ id: IdSchema, emi_day: EmiDaySchema, previous_emi_day: EmiDaySchema }),
  }),
  'fee.waive': z.strictObject({
    action: z.literal('fee.waive'),
    reference: CoreReferenceSchema,
    fee: z.strictObject({ id: IdSchema, status: z.literal('waived'), amount: PositiveMoneySchema }),
    balance: CoreBalanceSchema,
  }),
  'statement.view': z.strictObject({
    action: z.literal('statement.view'),
    account: AccountTypeSchema,
    balance: CoreBalanceSchema,
    /** Newest first, at most 20. */
    transactions: z.array(CoreTransactionSchema).max(20),
    as_of: IsoDateTimeSchema,
  }),
  'transfer.new_payee': transferResponse('transfer.new_payee'),
  'transfer.saved': transferResponse('transfer.saved'),
  'wire.new': transferResponse('wire.new'),
} as const satisfies Record<CoreActionId, z.ZodType>;

export type CoreResponse<A extends CoreActionId> = z.infer<(typeof CORE_RESPONSES)[A]>;
