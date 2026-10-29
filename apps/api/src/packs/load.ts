import {
  type CompiledPolicyPack,
  CompiledPolicyPackSchema,
  HalynError,
  type Region,
  REGIONS,
} from '@halyn/shared';
import { logLine } from '../http/errors';

// Compiled policy packs live in KV `CONFIG` under `pack:<tenant>:<region>` (JSON from `pnpm compile:packs`; the
// Worker never parses YAML). Each text is Zod-parsed once per isolate — the schema re-checks the critical and
// money-moving sets, so an edited pack in KV cannot relax invariant 5 (ADR-010).

export function packKey(tenant_id: string, region: Region): string {
  return `pack:${tenant_id}:${region}`;
}

const parsed = new Map<string, CompiledPolicyPack>();

function parse(text: string): CompiledPolicyPack {
  const cached = parsed.get(text);
  if (cached) return cached;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HalynError('E_FAIL_CLOSED', 'packs: a compiled pack in KV is not JSON');
  }
  const pack = CompiledPolicyPackSchema.safeParse(json);
  if (!pack.success) throw new HalynError('E_FAIL_CLOSED', 'packs: a compiled pack in KV is invalid');
  if (parsed.size > 16) parsed.clear();
  parsed.set(text, pack.data);
  return pack.data;
}

/**
 * The tenant's packs by region. A missing or invalid pack is left out: the Hub then decides `deny E_FAIL_CLOSED` for
 * calls in that region (an unknown policy is never guessed).
 */
export async function loadPacks(
  kv: KVNamespace,
  tenant_id: string,
): Promise<Partial<Record<Region, CompiledPolicyPack>>> {
  const out: Partial<Record<Region, CompiledPolicyPack>> = {};
  await Promise.all(
    REGIONS.map(async (region) => {
      try {
        const text = await kv.get(packKey(tenant_id, region), { cacheTtl: 60 });
        if (text !== null) {
          const pack = parse(text);
          if (pack.region === region) out[region] = pack;
        }
      } catch (err) {
        logLine({
          level: 'error',
          component: 'packs',
          region,
          detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
        });
      }
    }),
  );
  return out;
}
