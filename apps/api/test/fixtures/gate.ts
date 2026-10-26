// Test fixtures for the Gate: the real policy packs (compiled from YAML at test time), sample params for every
// action, and request/context builders with safe defaults (a registered caller, no signals).
import {
  type ActionId,
  type CompiledPolicyPack,
  compilePolicyPack,
  type Currency,
  fixedClock,
  type PolicyPackInput,
  PolicyPackSchema,
} from '@halyn/shared';
import { parse } from 'yaml';
import inYaml from '../../../../policy-packs/aero-in.yaml?raw';
import usYaml from '../../../../policy-packs/aero-us.yaml?raw';
import type { GateContext, ProposeRequest } from '../../src/gate';

export const SOURCE_SHA = 'ab'.repeat(32);
export const CLOCK = fixedClock(Date.UTC(2026, 9, 26, 10, 0, 0));
export const REGISTERED = '+919000000003';
export const UNREGISTERED = '+919000000001';
export const ASSISTANT = '+918065356379';

/** A fresh, mutable copy of a real pack's YAML source. */
export function packInput(region: 'IN' | 'US'): PolicyPackInput {
  return parse(region === 'IN' ? inYaml : usYaml) as PolicyPackInput;
}

export function compilePack(input: PolicyPackInput): CompiledPolicyPack {
  return compilePolicyPack(PolicyPackSchema.parse(input), SOURCE_SHA);
}

export const IN_PACK = compilePack(packInput('IN'));
export const US_PACK = compilePack(packInput('US'));

/** The IN pack with an edit applied to its YAML source (validated like a real pack). */
export function inPackWith(edit: (pack: PolicyPackInput) => void): CompiledPolicyPack {
  const input = packInput('IN');
  edit(input);
  return compilePack(input);
}

const SAMPLE: { [A in ActionId]: (currency: Currency, amount_minor: number) => Record<string, unknown> } = {
  'account.add_owner': () => ({ account: 'savings', owner_name: 'Asha Mishra' }),
  'account.close': () => ({ account: 'savings' }),
  'balance.view': () => ({ account: 'savings' }),
  'card.freeze': () => ({ card_last4: '8812' }),
  'card.reset_pin': () => ({ card_last4: '8812' }),
  'dispute.charge': (currency, amount_minor) => ({
    card_last4: '8812',
    amount_minor,
    currency,
    merchant: 'Corner Store',
  }),
  'emi.move_date': () => ({ loan_id: 'loan_personal_1', new_day: 10 }),
  'fee.waive': (currency, amount_minor) => ({ amount_minor, currency, fee_id: 'fee_late_oct' }),
  'loan.new': (currency, amount_minor) => ({ amount_minor, currency, tenure_months: 12 }),
  'profile.change_email': () => ({ new_email: 'saksham@example.com' }),
  'profile.change_mobile': () => ({ new_number: '+919000000002' }),
  'statement.view': () => ({ account: 'savings' }),
  'transfer.new_payee': (currency, amount_minor) => ({
    amount_minor,
    currency,
    payee_account_last4: '4471',
    payee_ifsc: 'AERO0000001',
  }),
  'transfer.saved': (currency, amount_minor) => ({ amount_minor, currency, payee_id: 'payee_mom' }),
  'upi.raise_limit': (currency, amount_minor) => ({ amount_minor, currency }),
  'wire.international': (currency, amount_minor) => ({
    amount_minor,
    currency,
    payee_account_last4: '3310',
    swift_bic: 'AEROUS33',
    payee_country: 'US',
  }),
  'wire.new': (currency, amount_minor) => ({
    amount_minor,
    currency,
    payee_account_last4: '3310',
    routing_last4: '0021',
  }),
};

/** Valid params for any action (actions without an amount ignore `amount_minor`). */
export function sampleParams(
  action: ActionId,
  currency: Currency = 'INR',
  amount_minor = 60000,
): Record<string, unknown> {
  return SAMPLE[action](currency, amount_minor);
}

export function request(
  action: ActionId = 'transfer.saved',
  overrides: Partial<ProposeRequest> = {},
): ProposeRequest {
  return {
    tenant_id: 'ten_aero',
    run_id: 'run_test_1',
    channel: 'phone',
    caller: { from_number: REGISTERED, kind: 'human' },
    customer_id: 'cus_saksham',
    action,
    params: sampleParams(action),
    readback_confirmed: true,
    caller_quotes: [],
    ...overrides,
  };
}

export interface ContextOverrides {
  proof?: GateContext['proof'];
  pass?: GateContext['pass'];
  counters?: Partial<GateContext['counters']>;
  signals?: Partial<GateContext['signals']>;
  coaching?: Partial<GateContext['coaching']>;
  distress?: boolean;
}

export function context(overrides: ContextOverrides = {}): GateContext {
  const base: GateContext = {
    proof: overrides.proof ?? 'registered_number',
    counters: { per_action_period: {}, transfers_last_10m: 0, ...overrides.counters },
    signals: { unregistered_number: false, calls_last_hour: 0, unusual_hour: false, ...overrides.signals },
    coaching: { score: 0, cues: [], ...overrides.coaching },
    distress: overrides.distress ?? false,
  };
  return overrides.pass ? { ...base, pass: overrides.pass } : base;
}

/** The demo Pass (docs/DATA_MODEL.md seed): statement, card freeze and one EMI move — plus fee.waive for tests. */
export const PASS: NonNullable<GateContext['pass']> = {
  scopes: [
    { action: 'statement.view' },
    { action: 'card.freeze' },
    { action: 'emi.move_date', max_uses: 1 },
    { action: 'fee.waive' },
  ],
  uses: {},
};
