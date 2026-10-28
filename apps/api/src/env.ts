import { E164Schema, HalynError, RegionSchema, TenantIdSchema } from '@halyn/shared';
import { z } from 'zod';

// Worker configuration, validated lazily per route group: /health needs nothing, and a route whose settings are
// missing or invalid fails closed (500 E_FAIL_CLOSED) without saying which one. Names match .env.example.

const Secret = z.string().min(32, 'at least 32 characters');
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/** "1.2.3.4, 5.6.7.8" → ["1.2.3.4", "5.6.7.8"]; at least one valid IPv4/IPv6 address. */
export const SourceIpsSchema = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().refine((ip) => IPV4.test(ip) || (ip.includes(':') && IPV6.test(ip)), 'invalid IP'))
      .min(1),
  );

/** `mysql://user:pass@host[:port]/database` for the TiDB Cloud serverless (HTTP) driver. */
export const TidbUrlSchema = z
  .string()
  .regex(/^mysql:\/\/[^:@/\s]+:[^@\s]+@[^/\s]+\/[A-Za-z0-9_]+$/, 'expected mysql://user:pass@host/database');

/** Bolna-facing tools and webhooks (bolnaGuard). */
export const ToolEnvSchema = z.object({
  BOLNA_SOURCE_IPS: SourceIpsSchema,
  HALYN_TOOL_SECRET: Secret,
});

/** Web sessions for the four apps. */
export const SessionEnvSchema = z.object({
  SESSION_SECRET: Secret,
  DEFAULT_TENANT_ID: TenantIdSchema,
  DEMO_ACCESS_CODE: z.string().min(8).optional(),
});

/** The TiDB system of record (the Hub's ledger flush, every query). */
export const DbEnvSchema = z.object({ TIDB_DATABASE_URL: TidbUrlSchema });

/** Halyn's signing material: grants, Passes, Pass codes, registered-number lookup. */
export const SigningEnvSchema = z.object({
  HALYN_SIGNING_KEY: z.string().min(1),
  HALYN_PUBLIC_JWKS: z.string().min(1),
  HALYN_KEY_ID: z.string().min(1).max(64),
  PASS_CODE_PEPPER: Secret,
  PHONE_HASH_PEPPER: Secret,
});

const Uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'expected a UUID');

/** The tenant Bolna's tools act for (one tenant per deployment; web routes take theirs from the session). */
export const TenantEnvSchema = z.object({ DEFAULT_TENANT_ID: TenantIdSchema });

/** Hashing calling numbers for lookup_customer and the callback check. */
export const PhoneEnvSchema = z.object({ PHONE_HASH_PEPPER: Secret });

/** Pass tokens are verified with Halyn's public keys (get_pass_code). */
export const JwksEnvSchema = z.object({ HALYN_PUBLIC_JWKS: z.string().min(1) });

/** Bolna's REST API: events into calls, outbound calls, executions (src/bolna). The base is overridable for tests. */
export const BolnaEnvSchema = z.object({
  BOLNA_API_KEY: z.string().min(1),
  BOLNA_API_BASE: z.url().optional(),
});

/**
 * The Confirm callback (src/confirm): Bolna's Confirm agent, calling from number B, and the one number it may ring —
 * Saksham's own (docs/COMPLIANCE.md: outbound calls only to numbers he owns). The callback rings it only when its hash
 * equals the customer's registered number. Missing or invalid → the step-up uses the passkey alone.
 */
export const ConfirmEnvSchema = z.object({
  BOLNA_CONFIRM_AGENT_ID: Uuid,
  NUMBER_B: E164Schema,
  CUSTOMER_PHONE: E164Schema,
});

/**
 * Saksham's Assistant (src/web/assistant.ts): Bolna's Assistant agent calls Aero's number A from number B — both
 * our own numbers (docs/COMPLIANCE.md). Missing → POST /web/assistant/tasks fails closed.
 */
export const AssistantEnvSchema = z.object({
  BOLNA_ASSISTANT_AGENT_ID: Uuid,
  NUMBER_A: E164Schema,
  NUMBER_B: E164Schema,
});

/** Aero Core: the AERO_CORE service binding when present, else this URL (src/core-client). */
export const CoreEnvSchema = z.object({ AERO_CORE_URL: z.url().optional() });

/** The region a phone call is in until lookup_customer says otherwise (number A is an Indian line). */
export const RegionEnvSchema = z.object({ DEFAULT_REGION: RegionSchema.default('IN') });

export const IntegrationsEnvSchema = z.object({
  BOLNA_API_KEY: z.string().min(1),
  SARVAM_API_KEY: z.string().min(1),
});

export const WebEnvSchema = z.object({
  /** The web app's origins (comma-separated): CORS allow-list and the only origins a passkey may come from. */
  WEB_ORIGIN: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  RP_ID: z.string().min(1),
});

/** Everything the API reads, for documentation and a full check (`/health` never needs it). */
export const EnvSchema = ToolEnvSchema.extend(SessionEnvSchema.shape)
  .extend(DbEnvSchema.shape)
  .extend(SigningEnvSchema.shape)
  .extend(IntegrationsEnvSchema.shape)
  .extend(WebEnvSchema.shape);
export type HalynEnv = z.output<typeof EnvSchema>;

/** Parse one group of settings from the Worker env, or fail closed without naming what is wrong. */
export function requireEnv<S extends z.ZodType>(env: unknown, schema: S): z.output<S> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', 'Service configuration is incomplete');
  return parsed.data;
}
