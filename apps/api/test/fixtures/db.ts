import type { PassRow } from '../../src/pass';

/** A valid `passes` row (unsigned placeholders; enough for SQL-shape and DB round-trip tests). */
export const TEST_PASS_ROW: PassRow = {
  id: 'pass_demo',
  tenant_id: 'ten_aero',
  customer_id: 'cus_saksham',
  assistant_name: "Saksham's Assistant",
  assistant_numbers: ['+918065356379'],
  scopes: [{ action: 'statement.view' }, { action: 'emi.move_date', max_uses: 1 }],
  issued_at: '2026-10-25T00:00:00.000Z',
  expires_at: '2026-11-24T00:00:00.000Z',
  status: 'active',
  customer_sig: 'seed_unsigned',
  issuer_sig: 'c2lnbmF0dXJl',
  failures: 0,
  revoked_at: null,
};
