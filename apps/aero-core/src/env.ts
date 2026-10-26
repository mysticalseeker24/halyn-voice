import { HalynError, type Jwks, JwksSchema, TenantIdSchema } from '@halyn/shared';
import { z } from 'zod';

// Aero Core's configuration, validated on every /core request. Anything missing or invalid fails closed
// (500 E_FAIL_CLOSED) without saying what: no grant can be checked, so nothing executes.
// HALYN_PUBLIC_JWKS is a secret (`wrangler secret put`, or .dev.vars locally); AERO_TENANT_ID is a var in wrangler.toml.

const RawEnvSchema = z.object({
  DB: z.custom<D1Database>(
    (value) => typeof value === 'object' && value !== null && 'batch' in value && 'prepare' in value,
  ),
  HALYN_PUBLIC_JWKS: z.string().min(1),
  /** The Halyn tenant this bank is; every grant must name it (`expectedTenant`), and every row carries it. */
  AERO_TENANT_ID: TenantIdSchema,
});

export interface CoreEnv {
  db: D1Database;
  tenant: string;
  /** Parsed once per isolate and reused, so @halyn/sdk's per-object key cache applies. */
  jwks: Jwks;
}

const FAIL = 'Service configuration is incomplete';
let cached: { raw: string; jwks: Jwks } | undefined;

function publicJwks(raw: string): Jwks {
  if (cached?.raw === raw) return cached.jwks;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new HalynError('E_FAIL_CLOSED', FAIL);
  }
  const parsed = JwksSchema.safeParse(json);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', FAIL);
  cached = { raw, jwks: parsed.data };
  return parsed.data;
}

export function requireCoreEnv(env: unknown): CoreEnv {
  const parsed = RawEnvSchema.safeParse(env);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', FAIL);
  return {
    db: parsed.data.DB,
    tenant: parsed.data.AERO_TENANT_ID,
    jwks: publicJwks(parsed.data.HALYN_PUBLIC_JWKS),
  };
}
