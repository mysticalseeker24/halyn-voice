import {
  HalynError,
  HandoffListResponseSchema,
  HandoffResolveRequestSchema,
  HandoffResolveResponseSchema,
} from '@halyn/shared';
import type { Context } from 'hono';
import { flowContext, type AppDeps } from '../flow/context';
import { executeRequest } from '../flow/execute';
import type { AppEnv } from '../http/app-env';
import { readJson } from './session-route';

// Console Handoffs (docs/API.md "Web", docs/UI.md): every hold a specialist must look at, newest first, from the
// Hub's read model; release or block, first resolution wins. Releasing a held request approves it and the Worker
// executes it like any approval — a grant bound to the exact action, presented to Aero Core (invariant 1).

function consoleTenant(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (session.kind !== 'console') throw new HalynError('E_UNAUTHORIZED', 'A console session is required');
  return session.tenant_id;
}

/** GET /web/handoffs → `{handoffs}`. */
export function listHandoffs(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const flow = flowContext(c.env, consoleTenant(c), deps);
    return c.json(HandoffListResponseSchema.parse({ handoffs: await flow.hub.handoffs(100) }));
  };
}

/** POST /web/handoffs/:id/resolve `{action: release|block, note?}` → `{ok, status}`. */
export function resolveHandoffRoute(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const flow = flowContext(c.env, consoleTenant(c), deps);
    const body = HandoffResolveRequestSchema.parse(await readJson(c));
    const { handoff, request } = await flow.hub.resolveHandoff({
      id: c.req.param('id') ?? '',
      action: body.action,
      note: body.note ?? null,
    });
    if (request?.status === 'approved')
      c.executionCtx.waitUntil(executeRequest(flow, request.request_id).catch(() => null));
    return c.json(
      HandoffResolveResponseSchema.parse({
        ok: true,
        status: handoff.status === 'released' ? 'released' : 'blocked',
      }),
    );
  };
}
