import {
  ActionIdSchema,
  FinalOutcomeSchema,
  OutcomeSchema,
  ReasonCodeSchema,
  RegionSchema,
} from '@halyn/shared';
import { z } from 'zod';
import specJson from '../../../../tests/scenarios/scenarios.json';

// tests/scenarios/scenarios.yaml as the runner reads it. The Worker never parses YAML (CLAUDE.md §6): it imports the
// committed JSON twin, and apps/api/test/scenarios/spec.test.ts fails if the two ever differ.

const Quotes = z.array(z.string().max(2000)).max(20);

export const ProposeStepSchema = z.strictObject({
  action: ActionIdSchema,
  params: z.record(z.string(), z.json()),
  readback_confirmed: z.boolean(),
  caller_quotes: Quotes.optional(),
});
export type ProposeStep = z.infer<typeof ProposeStepSchema>;

export const ExpectSchema = z.strictObject({
  decision: OutcomeSchema.optional(),
  final: FinalOutcomeSchema.optional(),
  reasons_include: z.array(ReasonCodeSchema).optional(),
  core_called: z.boolean().optional(),
  events: z.array(z.string()).optional(),
  confirmation_channels: z.array(z.enum(['passkey', 'callback'])).optional(),
  alert_sent: z.boolean().optional(),
  step_up_offered: z.boolean().optional(),
  handoff_created: z.boolean().optional(),
  valid: z.boolean().optional(),
  http_status: z.int().optional(),
  reason: ReasonCodeSchema.optional(),
});
export type Expect = z.infer<typeof ExpectSchema>;

export const StepSchema = z.strictObject({
  propose: ProposeStepSchema.optional(),
  verify_pass: z.strictObject({ code: z.literal('from_pass') }).optional(),
  direct_core_call: z
    .strictObject({ path: z.string().startsWith('/core/'), grant: z.literal('none') })
    .optional(),
  confirm_answer: z
    .strictObject({
      channel: z.enum(['passkey', 'callback', 'none']),
      answer: z.enum(['approve', 'decline']).optional(),
      after_ms: z.int().nonnegative(),
    })
    .optional(),
  expect: ExpectSchema.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const CallerFromSchema = z.enum([
  'registered',
  'unregistered',
  'assistant',
  'unknown_ai',
  'app_session',
]);
export type CallerFrom = z.infer<typeof CallerFromSchema>;

export const ScenarioSchema = z.strictObject({
  id: z.union([z.int(), z.string()]).transform(String),
  title: z.string().min(1),
  region: RegionSchema,
  caller: z.strictObject({
    from: CallerFromSchema,
    kind: z.enum(['human', 'ai_assistant', 'unknown']),
    language: z.enum(['hi', 'en']).optional(),
    tags: z.array(z.string()).optional(),
    pass: z.string().optional(),
  }),
  steps: z.array(StepSchema).min(1),
  repeat: z.int().min(1).max(50).optional(),
  interval_ms: z.int().nonnegative().optional(),
  expect_sequence: z
    .array(
      z.strictObject({
        index: z.int().positive().optional(),
        from_index: z.int().positive().optional(),
        decision: OutcomeSchema,
        reasons_include: z.array(ReasonCodeSchema).optional(),
      }),
    )
    .optional(),
  compare_in_region: RegionSchema.optional(),
  compare_step: StepSchema.optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioSpecSchema = z.object({
  version: z.literal(1),
  customer: z.strictObject({ id: z.string(), name: z.string(), registered_number: z.string() }),
  numbers: z.strictObject({ unregistered: z.string(), assistant: z.string(), unknown_ai: z.string() }),
  scenarios: z.array(ScenarioSchema).min(1),
});
export type ScenarioSpec = z.infer<typeof ScenarioSpecSchema>;

/** The acceptance spec bundled with the Worker (the Stage's text runs). */
export function bundledSpec(): ScenarioSpec {
  return ScenarioSpecSchema.parse(specJson);
}
