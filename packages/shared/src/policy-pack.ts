import { z } from 'zod';
import {
  ACTION_IDS,
  type ActionId,
  ActionIdSchema,
  carriesAmount,
  isCriticalAction,
  movesMoney,
} from './actions';
import { ConfirmChannelSchema } from './decision';
import { HalynError } from './errors';
import { Hex64Schema } from './ids';
import { CurrencySchema } from './money';
import { REGION_CURRENCY, RegionSchema } from './region';

// Source shape: policy-packs/*.yaml, validated by scripts/compile-packs.ts at build time.
// Runtime shape: CompiledPolicyPack (normalised JSON in KV). YAML is never parsed at runtime.

export const POLICY_PACK_SCHEMA = 'halyn-policy-pack/1';
export const LIMIT_PERIODS = ['day', 'month', 'year'] as const;

const LimitSchema = z
  .strictObject({
    amount_minor: z.int().positive().optional(),
    count: z.int().positive().optional(),
    per: z.enum(LIMIT_PERIODS),
  })
  .refine(
    (l) => l.amount_minor !== undefined || l.count !== undefined,
    'a limit needs amount_minor or count',
  );

const AgentActionSchema = z.strictObject({
  tier: z.int().min(0).max(4),
  protective: z.boolean().optional(),
  read: z.boolean().optional(),
  pass_eligible: z.boolean(),
  limit: LimitSchema.optional(),
  cap_first_24h_minor: z.int().positive().optional(),
  hold_hours: z.int().positive().max(168).optional(),
  human_only_above_minor: z.int().positive().optional(),
});
const HumanOnlyActionSchema = z.strictObject({ perimeter: z.literal('human_only') });
export const PackActionSchema = z.union([AgentActionSchema, HumanOnlyActionSchema]);
export type PackAction = z.infer<typeof PackActionSchema>;

const SignalWeight = z.int().min(0).max(4);
const SignalWeightsSchema = z.strictObject({
  unregistered_number: SignalWeight,
  calls_last_hour_gte_3: SignalWeight,
  unusual_hour: SignalWeight,
  liveness_below_0_3: SignalWeight,
  transfers_last_10m_gte_2: SignalWeight,
});

const PackIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a lower-case pack id');
const CoachingSchema = z.strictObject({ threshold: z.number().min(0).max(1) });
const ConfirmSchema = z.strictObject({
  timeout_seconds: z.int().min(10).max(600),
  channels: z.array(ConfirmChannelSchema).min(1),
});
const HandoffSchema = z.strictObject({
  specialist_number_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'expected an env var name'),
});

export const PolicyPackSchema = z
  .strictObject({
    pack: PackIdSchema,
    version: z.int().positive(),
    region: RegionSchema,
    currency: CurrencySchema,
    coaching: CoachingSchema,
    confirm: ConfirmSchema,
    actions: z.partialRecord(ActionIdSchema, PackActionSchema),
    signals: SignalWeightsSchema,
    handoff: HandoffSchema,
  })
  .superRefine((pack, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (REGION_CURRENCY[pack.region] !== pack.currency)
      issue(['currency'], `region ${pack.region} uses ${REGION_CURRENCY[pack.region]}, not ${pack.currency}`);
    if (new Set(pack.confirm.channels).size !== pack.confirm.channels.length)
      issue(['confirm', 'channels'], 'confirm channels must be unique');
    const entries = Object.entries(pack.actions) as [ActionId, PackAction][];
    if (entries.length === 0) issue(['actions'], 'a pack needs at least one action');
    for (const [id, action] of entries) {
      if (!('tier' in action)) continue;
      const at = (field: string, message: string) => issue(['actions', id, field], `${id}: ${message}`);
      if (action.pass_eligible && isCriticalAction(id))
        at('pass_eligible', 'critical actions can never be in a Pass (invariant 5)');
      if (action.protective) {
        if (action.tier !== 0) at('tier', 'protective actions are tier 0');
        if (movesMoney(id)) at('protective', 'a money-moving action cannot be protective');
        if (action.read) at('read', 'an action is protective or read, not both');
      }
      if (action.read && movesMoney(id)) at('read', 'a money-moving action is not a read');
      if (!carriesAmount(id)) {
        if (action.limit?.amount_minor !== undefined)
          at('limit', 'amount limit on an action without an amount');
        if (action.cap_first_24h_minor !== undefined)
          at('cap_first_24h_minor', 'cap on an action without an amount');
        if (action.human_only_above_minor !== undefined)
          at('human_only_above_minor', 'threshold on an action without an amount');
      }
      if ((action.tier === 4) !== (action.hold_hours !== undefined))
        at('hold_hours', 'tier-4 actions, and only they, carry hold_hours');
    }
  });
export type PolicyPackInput = z.input<typeof PolicyPackSchema>;
export type PolicyPack = z.output<typeof PolicyPackSchema>;

export type ValidatePolicyPackResult = { ok: true; pack: PolicyPack } | { ok: false; error: string };

export function validatePolicyPack(input: unknown): ValidatePolicyPackResult {
  const parsed = PolicyPackSchema.safeParse(input);
  return parsed.success
    ? { ok: true, pack: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

const CompiledLimitSchema = z.strictObject({
  amount_minor: z.int().positive().nullable(),
  count: z.int().positive().nullable(),
  per: z.enum(LIMIT_PERIODS),
});

const CompiledAgentActionSchema = z.strictObject({
  perimeter: z.literal('agent'),
  tier: z.int().min(0).max(4),
  read: z.boolean(),
  protective: z.boolean(),
  pass_eligible: z.boolean(),
  moves_money: z.boolean(),
  critical: z.boolean(),
  limit: CompiledLimitSchema.nullable(),
  cap_first_24h_minor: z.int().positive().nullable(),
  hold_hours: z.int().positive().nullable(),
  human_only_above_minor: z.int().positive().nullable(),
});

const CompiledHumanOnlyActionSchema = z.strictObject({
  perimeter: z.literal('human_only'),
  tier: z.null(),
  read: z.literal(false),
  protective: z.literal(false),
  pass_eligible: z.literal(false),
  moves_money: z.boolean(),
  critical: z.boolean(),
  limit: z.null(),
  cap_first_24h_minor: z.null(),
  hold_hours: z.null(),
  human_only_above_minor: z.null(),
});

/** Normalised action: every field present, explicit defaults, no optional keys for the Gate to guess. */
export const CompiledActionSchema = z.discriminatedUnion('perimeter', [
  CompiledAgentActionSchema,
  CompiledHumanOnlyActionSchema,
]);
export type CompiledAction = z.infer<typeof CompiledActionSchema>;

/** What the API loads from KV (`CONFIG`) and Zod-parses before the Gate sees it. */
export const CompiledPolicyPackSchema = z
  .strictObject({
    schema: z.literal(POLICY_PACK_SCHEMA),
    pack: PackIdSchema,
    version: z.int().positive(),
    region: RegionSchema,
    currency: CurrencySchema,
    source_sha: Hex64Schema,
    coaching: CoachingSchema,
    confirm: ConfirmSchema,
    signals: SignalWeightsSchema,
    handoff: HandoffSchema,
    actions: z.partialRecord(ActionIdSchema, CompiledActionSchema),
  })
  .superRefine((pack, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (REGION_CURRENCY[pack.region] !== pack.currency) issue(['currency'], 'region and currency disagree');
    // These flags come from code, not policy: a stale or edited pack in KV must not relax them.
    for (const [id, action] of Object.entries(pack.actions) as [ActionId, CompiledAction][]) {
      const at = (field: string, message: string) => issue(['actions', id, field], `${id}: ${message}`);
      if (action.critical !== isCriticalAction(id)) at('critical', 'does not match CRITICAL_ACTIONS');
      if (action.moves_money !== movesMoney(id)) at('moves_money', 'does not match the money-moving set');
      if (action.critical && action.pass_eligible)
        at('pass_eligible', 'critical actions can never be in a Pass (invariant 5)');
      if (action.protective && (action.tier !== 0 || action.read || action.moves_money))
        at('protective', 'protective actions are tier 0, not reads and never move money');
    }
  });
export type CompiledPolicyPack = z.infer<typeof CompiledPolicyPackSchema>;

function compileAction(id: ActionId, action: PackAction): CompiledAction {
  const moves_money = movesMoney(id);
  const critical = isCriticalAction(id);
  if (!('tier' in action)) {
    return {
      perimeter: 'human_only',
      tier: null,
      read: false,
      protective: false,
      pass_eligible: false,
      moves_money,
      critical,
      limit: null,
      cap_first_24h_minor: null,
      hold_hours: null,
      human_only_above_minor: null,
    };
  }
  return {
    perimeter: 'agent',
    tier: action.tier,
    read: action.read ?? false,
    protective: action.protective ?? false,
    pass_eligible: action.pass_eligible,
    moves_money,
    critical,
    limit: action.limit
      ? {
          amount_minor: action.limit.amount_minor ?? null,
          count: action.limit.count ?? null,
          per: action.limit.per,
        }
      : null,
    cap_first_24h_minor: action.cap_first_24h_minor ?? null,
    hold_hours: action.hold_hours ?? null,
    human_only_above_minor: action.human_only_above_minor ?? null,
  };
}

/** Pure: a validated pack plus the SHA-256 of its YAML → the runtime pack. Same input, same bytes out. */
export function compilePolicyPack(pack: PolicyPack, sourceSha: string): CompiledPolicyPack {
  if (!Hex64Schema.safeParse(sourceSha).success)
    throw new HalynError('E_FAIL_CLOSED', 'compilePolicyPack: source_sha must be lower-case SHA-256 hex');
  const actions: Partial<Record<ActionId, CompiledAction>> = {};
  for (const id of ACTION_IDS) {
    const action = pack.actions[id];
    if (action) actions[id] = compileAction(id, action);
  }
  return CompiledPolicyPackSchema.parse({
    schema: POLICY_PACK_SCHEMA,
    pack: pack.pack,
    version: pack.version,
    region: pack.region,
    currency: pack.currency,
    source_sha: sourceSha,
    coaching: pack.coaching,
    confirm: pack.confirm,
    signals: pack.signals,
    handoff: pack.handoff,
    actions,
  });
}

/** The pack's rules for an action, or undefined when the region does not offer it (the Gate then denies). */
export function packAction(pack: CompiledPolicyPack, action: ActionId): CompiledAction | undefined {
  return pack.actions[action];
}
