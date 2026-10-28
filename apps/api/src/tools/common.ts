import { type BolnaTool, HalynError, normalizeToolBody } from '@halyn/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import { RegionEnvSchema, requireEnv, TenantEnvSchema } from '../env';
import { type AppDeps, type FlowContext, flowContext } from '../flow/context';
import type { AppEnv } from '../http/app-env';

// Shared plumbing for the Bolna tools (docs/API.md "Bolna-facing tools"). The bolnaGuard has already checked the
// source IP and x-halyn-secret. Bodies are normalised from Bolna's `%(name)s` substitutions (packages/shared
// bolna-payloads.ts), the run id falls back to the call's call_sid, then the strict schema decides (400 on failure).

export interface ToolContext {
  flow: FlowContext;
  tenant: string;
  region: 'IN' | 'US';
}

export function toolContext(c: Context<AppEnv>, deps: AppDeps): ToolContext {
  const { DEFAULT_TENANT_ID } = requireEnv(c.env, TenantEnvSchema);
  const { DEFAULT_REGION } = requireEnv(c.env, RegionEnvSchema);
  return {
    flow: flowContext(c.env, DEFAULT_TENANT_ID, deps),
    tenant: DEFAULT_TENANT_ID,
    region: DEFAULT_REGION,
  };
}

async function rawJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HalynError('E_BAD_REQUEST', 'The body must be JSON');
  }
}

/**
 * The tool body as `schema` reads it. When Bolna could not substitute the run id (`%(execution_id)s`, docs/DAY0.md
 * check 2), the call is found by its call_sid from an earlier webhook, or keyed as `sid:<call_sid>` so idempotency and
 * check_decision polling still work (events need a real run id and are skipped).
 */
export async function readToolBody<S extends z.ZodType>(
  c: Context<AppEnv>,
  tool: BolnaTool,
  schema: S,
  ctx: ToolContext,
): Promise<{ body: z.output<S>; raw: Record<string, unknown> }> {
  const normalized = normalizeToolBody(tool, await rawJson(c));
  if (normalized === null || typeof normalized !== 'object' || Array.isArray(normalized))
    throw new HalynError('E_BAD_REQUEST', 'The body must be a JSON object');
  const raw = normalized as Record<string, unknown>;
  if (raw.run_id === undefined && typeof raw.call_sid === 'string') {
    const known = await ctx.flow.hub.runIdForCallSid(raw.call_sid);
    raw.run_id = known ?? `sid:${raw.call_sid}`;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HalynError('E_BAD_REQUEST', `Invalid ${tool} body`);
  return { body: parsed.data, raw };
}
