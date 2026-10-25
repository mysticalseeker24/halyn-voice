import { z } from 'zod';
import { E164Schema, IdSchema, Last4Schema } from './ids';
import { CurrencySchema, type Money, PositiveAmountMinorSchema } from './money';

/** Every action in policy-packs/*.yaml (sorted, so compiled packs list actions in this order). */
export const ACTION_IDS = [
  'account.add_owner',
  'account.close',
  'balance.view',
  'card.freeze',
  'card.reset_pin',
  'dispute.charge',
  'emi.move_date',
  'fee.waive',
  'loan.new',
  'profile.change_email',
  'profile.change_mobile',
  'statement.view',
  'transfer.new_payee',
  'transfer.saved',
  'upi.raise_limit',
  'wire.international',
  'wire.new',
] as const;

export const ActionIdSchema = z.enum(ACTION_IDS);
export type ActionId = z.infer<typeof ActionIdSchema>;

// Params never carry full account or card numbers: last 4 digits, payee ids or bank codes only.
const AccountSchema = z.enum(['savings', 'current', 'checking']);
const NameSchema = z.string().min(1).max(80);
const IfscSchema = z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'expected an IFSC code');
const SwiftBicSchema = z.string().regex(/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/, 'expected a SWIFT/BIC code');
const CountrySchema = z.string().regex(/^[A-Z]{2}$/, 'expected an ISO 3166 alpha-2 country');
const amount = { amount_minor: PositiveAmountMinorSchema, currency: CurrencySchema };

/**
 * Strict params per action: unknown keys are rejected, because the grant's params_hash binds the exact
 * parameters Aero Core will execute.
 */
export const ACTION_PARAMS = {
  'account.add_owner': z.strictObject({ account: AccountSchema, owner_name: NameSchema }),
  'account.close': z.strictObject({ account: AccountSchema }),
  'balance.view': z.strictObject({ account: AccountSchema }),
  'card.freeze': z.strictObject({ card_last4: Last4Schema }),
  'card.reset_pin': z.strictObject({ card_last4: Last4Schema }),
  'dispute.charge': z.strictObject({ card_last4: Last4Schema, ...amount, merchant: NameSchema }),
  'emi.move_date': z.strictObject({ loan_id: IdSchema, new_day: z.int().min(1).max(28) }),
  'fee.waive': z.strictObject({ ...amount, fee_id: IdSchema }),
  'loan.new': z.strictObject({ ...amount, tenure_months: z.int().min(1).max(360) }),
  'profile.change_email': z.strictObject({ new_email: z.email().max(254) }),
  'profile.change_mobile': z.strictObject({ new_number: E164Schema }),
  'statement.view': z.strictObject({ account: AccountSchema }),
  'transfer.new_payee': z.strictObject({
    ...amount,
    payee_account_last4: Last4Schema,
    payee_ifsc: IfscSchema,
    payee_name: NameSchema.optional(),
  }),
  'transfer.saved': z.strictObject({ ...amount, payee_id: IdSchema }),
  'upi.raise_limit': z.strictObject({ ...amount }),
  'wire.international': z.strictObject({
    ...amount,
    payee_account_last4: Last4Schema,
    swift_bic: SwiftBicSchema,
    payee_country: CountrySchema,
  }),
  'wire.new': z.strictObject({ ...amount, payee_account_last4: Last4Schema, routing_last4: Last4Schema }),
} as const satisfies Record<ActionId, z.ZodType>;

export type ActionParams<A extends ActionId> = z.infer<(typeof ACTION_PARAMS)[A]>;

const proposal = <A extends ActionId>(action: A) =>
  z.strictObject({ action: z.literal(action), params: ACTION_PARAMS[action] });

/** An action with params validated for that action. */
export const ProposedActionSchema = z.discriminatedUnion('action', [
  proposal('account.add_owner'),
  proposal('account.close'),
  proposal('balance.view'),
  proposal('card.freeze'),
  proposal('card.reset_pin'),
  proposal('dispute.charge'),
  proposal('emi.move_date'),
  proposal('fee.waive'),
  proposal('loan.new'),
  proposal('profile.change_email'),
  proposal('profile.change_mobile'),
  proposal('statement.view'),
  proposal('transfer.new_payee'),
  proposal('transfer.saved'),
  proposal('upi.raise_limit'),
  proposal('wire.international'),
  proposal('wire.new'),
]);
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export type ParseActionResult = { ok: true; value: ProposedAction } | { ok: false; error: string };

/** Validate an agent's proposal without throwing. Failure means the Gate denies with E_FAIL_CLOSED. */
export function parseActionParams(action: string, params: unknown): ParseActionResult {
  const parsed = ProposedActionSchema.safeParse({ action, params });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

const MONEY_MOVING = new Set<ActionId>([
  'loan.new',
  'transfer.new_payee',
  'transfer.saved',
  'upi.raise_limit',
  'wire.international',
  'wire.new',
]);
export const MONEY_MOVING_ACTIONS: readonly ActionId[] = ACTION_IDS.filter((a) => MONEY_MOVING.has(a));

/** Invariant 5: critical actions are never in a Pass (number/email changes, closing, owners, new payees, wires). */
export const CRITICAL_ACTIONS = [
  'account.add_owner',
  'account.close',
  'profile.change_email',
  'profile.change_mobile',
  'transfer.new_payee',
  'wire.international',
  'wire.new',
] as const satisfies readonly ActionId[];

export function isCriticalAction(action: ActionId): boolean {
  return (CRITICAL_ACTIONS as readonly ActionId[]).includes(action);
}

export function movesMoney(action: ActionId): boolean {
  return MONEY_MOVING.has(action);
}

/** True when the action's params include an amount (limits and caps only apply to these). */
export function carriesAmount(action: ActionId): boolean {
  return 'amount_minor' in ACTION_PARAMS[action].shape;
}

export function actionAmount(proposed: ProposedAction): Money | null {
  if (!('amount_minor' in proposed.params)) return null;
  return { amount_minor: proposed.params.amount_minor, currency: proposed.params.currency };
}
