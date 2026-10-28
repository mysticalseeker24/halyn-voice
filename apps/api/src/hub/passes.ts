import type { JsonValue } from '@halyn/shared';
import { type PassRow, PassRowSchema, revokePass } from '../pass';
import type { HubCore } from './flows';

// Passes in the Hub (docs/PASS.md): issue (the Worker verified the customer's passkey consent and signed the token),
// revoke (one tap, effective at once: every mint and verify reads this row) and list. Each change is mirrored to
// TiDB as a whole row and appended to the ledger. The Assistant call Halyn places is bound to one Pass, so its
// get_pass_code needs no token in the LLM's hands.

function json(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

/** Store a newly issued Pass (status active) and append pass_issued. */
export async function savePass(core: HubCore, row: PassRow): Promise<PassRow> {
  const pass = PassRowSchema.parse(row);
  if (pass.tenant_id !== core.tenant || core.store.pass(pass.id))
    throw new Error('hub: Pass belongs to another tenant or already exists');
  core.store.putPass(pass);
  core.mirror({ kind: 'pass_row', row: json(pass) });
  await core.append({
    type: 'pass_issued',
    ref_id: pass.id,
    payload: {
      customer_id: pass.customer_id,
      assistant_name: pass.assistant_name,
      scopes: pass.scopes.map((s) => s.action),
      expires_at: pass.expires_at,
    },
  });
  return pass;
}

/** Revoke the customer's own Pass. Null when it is not theirs (indistinguishable from none, invariant 8). */
export async function revokeCustomerPass(
  core: HubCore,
  customer_id: string,
  pass_id: string,
): Promise<PassRow | null> {
  const pass = core.store.pass(pass_id);
  if (!pass || pass.customer_id !== customer_id) return null;
  if (pass.status === 'revoked') return pass;
  const revoked = revokePass(pass, core.clock);
  core.store.putPass(revoked);
  core.mirror({ kind: 'pass_row', row: json(revoked) });
  await core.append({
    type: 'pass_revoked',
    ref_id: revoked.id,
    payload: { customer_id, at: revoked.revoked_at },
  });
  return revoked;
}
