import {
  type CompiledPolicyPack,
  E164Schema,
  HalynError,
  PASS_VERSION,
  PassClaimsSchema,
  type Signer,
} from '@halyn/shared';
import { type PassRow, passRow, signPass } from '../pass';
import { last4, registeredNumberHash } from './numbers';
import type { customers, policyPacks, tenants } from './schema';

// The demo seed (docs/DATA_MODEL.md "Seed"), built deterministically: fixed ids and a fixed clock, and Ed25519
// signatures are deterministic, so the same inputs always give the same rows. scripts/seed.ts writes them to TiDB.
// Aero Core's D1 rows (same ids: ten_aero, cus_saksham, cus_saksham_us) come from apps/aero-core/src/seed.

/** The seed's clock: every created_at and the Pass issue time. */
export const SEED_TIME_MS = Date.UTC(2026, 9, 25, 0, 0, 0);
export const SEED_TENANT = 'ten_aero';
/** Number B: the assistant's calling number (docs/STATE.md). */
export const ASSISTANT_NUMBER = '+918065356379';
const PASS_DAYS = 30;
/** The customer's name as voices say it (lookup_customer, the Confirm call's user_data). */
export const SPOKEN_NAME = 'सक्षम';

export interface SeedInput {
  /** The customer's registered number (CUSTOMER_PHONE). */
  customerPhone: string;
  phoneHashPepper: string;
  signer: Signer;
  packs: readonly CompiledPolicyPack[];
}

export interface SeedRows {
  tenant: typeof tenants.$inferInsert;
  customers: (typeof customers.$inferInsert)[];
  policyPacks: (typeof policyPacks.$inferInsert)[];
  pass: PassRow;
  passToken: string;
}

export async function buildSeed(input: SeedInput): Promise<SeedRows> {
  if (!E164Schema.safeParse(input.customerPhone).success)
    throw new HalynError('E_FAIL_CLOSED', 'seed: CUSTOMER_PHONE must be an E.164 number');
  if (input.customerPhone === ASSISTANT_NUMBER)
    throw new HalynError('E_FAIL_CLOSED', "seed: the customer's number cannot be the assistant's number");
  const created_at = new Date(SEED_TIME_MS);
  const numberHash = await registeredNumberHash(input.phoneHashPepper, input.customerPhone);
  const customer = (id: string, region: 'IN' | 'US', language: string) => ({
    id,
    tenant_id: SEED_TENANT,
    name: 'Saksham Mishra',
    // Voices say the Devanagari form: Sarvam speaks Roman "Saksham" with a long "Saa" (CLAUDE.md §8).
    spoken_name: SPOKEN_NAME,
    region,
    language,
    registered_number_hash: numberHash,
    registered_number_last4: last4(input.customerPhone),
    passkey_credential: null,
    created_at,
  });

  const iat = Math.floor(SEED_TIME_MS / 1000);
  const claims = PassClaimsSchema.parse({
    v: PASS_VERSION,
    pid: 'pass_demo',
    tenant: SEED_TENANT,
    sub: 'cus_saksham',
    assistant: { name: "Saksham's Assistant", numbers: [ASSISTANT_NUMBER] },
    scopes: [
      { action: 'statement.view' },
      { action: 'card.freeze' },
      { action: 'emi.move_date', max_uses: 1 },
    ],
    iat,
    exp: iat + PASS_DAYS * 24 * 60 * 60,
    // Placeholder until the customer's passkey exists (Step 10 issues Passes with a real WebAuthn assertion).
    cnf: { customer_passkey_sig: 'seed_unsigned' },
  });
  const passToken = await signPass(claims, input.signer);

  return {
    tenant: {
      id: SEED_TENANT,
      name: 'Aero Bank',
      default_region: 'IN',
      signing_key_id: input.signer.kid,
      created_at,
    },
    // Same person, same number, two regions; phone lookups are per region (number A is IN), and the US twin
    // reaches Aero through a browser session (scenario 10).
    customers: [customer('cus_saksham', 'IN', 'hi'), customer('cus_saksham_us', 'US', 'en')],
    policyPacks: input.packs.map((pack) => ({
      id: `${pack.pack}-v${pack.version}`,
      tenant_id: SEED_TENANT,
      region: pack.region,
      version: pack.version,
      compiled_json: pack,
      source_sha: pack.source_sha,
      created_at,
    })),
    pass: passRow(claims, passToken),
    passToken,
  };
}
