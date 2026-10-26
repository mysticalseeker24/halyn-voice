// A real issued Pass (issue → sign → row) for tests: the seed Pass from docs/DATA_MODEL.md.
import { fixedClock, type PassScope } from '@halyn/shared';
import { issuePass, type PassRow, passRow, signPass } from '../../src/pass';
import { seededRng, testKeys } from './crypto';
import { IN_PACK } from './gate';

export const NOW = Date.UTC(2026, 9, 26, 10, 0, 0);
export const CLOCK = fixedClock(NOW);
export const ASSISTANT_NUMBER = '+918065356379';
export const OTHER_NUMBER = '+919000000002';
export const PEPPER = 'test-pepper-0123456789abcdef';
export const SEED_SCOPES: PassScope[] = [
  { action: 'statement.view' },
  { action: 'card.freeze' },
  { action: 'emi.move_date', max_uses: 1 },
];

export async function issuedPass(overrides: Partial<PassRow> = {}) {
  const keys = await testKeys('halyn-2026-10');
  const issued = issuePass(
    {
      tenant: 'ten_aero',
      customer_id: 'cus_saksham',
      assistant: { name: "Saksham's Assistant", numbers: [ASSISTANT_NUMBER] },
      scopes: SEED_SCOPES,
      expires_in_days: 7,
      customer_passkey_sig: 'c2lnbmF0dXJl',
    },
    IN_PACK,
    CLOCK,
    seededRng(7),
  );
  if (!issued.ok) throw new Error(`fixture: ${issued.message}`);
  const token = await signPass(issued.claims, keys.signer);
  return { keys, claims: issued.claims, token, row: { ...passRow(issued.claims, token), ...overrides } };
}
