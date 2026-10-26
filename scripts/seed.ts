// pnpm seed [--db halyn_dev|halyn] [--test-number +9190000000NN] [--keys-file <private JWK file>]
// Deterministic demo seed (docs/DATA_MODEL.md "Seed"): tenant ten_aero, the IN customer and the US twin, both policy
// packs, and Pass pass_demo for the assistant. Upserts, so re-running is safe. The registered number comes from
// CUSTOMER_PHONE (env only) and is never printed; --test-number swaps in a +9190000000NN test number for dry runs.
// Aero Core's D1 seed (accounts, cards, fees, loans, payees, transactions) is `pnpm seed:core` (scripts/seed-core.ts).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compilePolicyPack,
  type CompiledPolicyPack,
  importSigningKey,
  validatePolicyPack,
} from '@halyn/shared';
import { parse } from 'yaml';
import { createDb } from '../apps/api/src/db/client';
import { upsertCustomer, upsertPass, upsertPolicyPack, upsertTenant } from '../apps/api/src/db/queries';
import { buildSeed, SEED_TENANT } from '../apps/api/src/db/seed-data';
import { loadDotEnv, parseDbArg, repoRoot, tidbUrl } from './lib/tidb';

const TEST_NUMBER = /^\+9190000000\d{2}$/;

function option(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

export function compiledPacks(): CompiledPolicyPack[] {
  const dir = join(repoRoot, 'policy-packs');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const bytes = readFileSync(join(dir, file));
      const result = validatePolicyPack(parse(bytes.toString('utf8')));
      if (!result.ok) throw new Error(`policy-packs/${file} is invalid: run pnpm compile:packs for details`);
      return compilePolicyPack(result.pack, createHash('sha256').update(bytes).digest('hex'));
    });
}

async function main(args: string[]): Promise<void> {
  loadDotEnv();
  const database = parseDbArg(args);
  if (database === 'halyn_test')
    throw new Error('halyn_test is for integration tests; seed halyn_dev or halyn');
  const testNumber = option(args, '--test-number');
  if (testNumber !== undefined && !TEST_NUMBER.test(testNumber))
    throw new Error('--test-number must be a +9190000000NN test number');
  const customerPhone = testNumber ?? process.env.CUSTOMER_PHONE;
  if (!customerPhone)
    throw new Error(
      "CUSTOMER_PHONE is not set in .env (Saksham's own number, env only). For a dry run use --test-number +919000000003.",
    );
  const pepper = process.env.PHONE_HASH_PEPPER;
  if (!pepper || pepper.length < 32)
    throw new Error(
      'PHONE_HASH_PEPPER (32+ random characters) is not set in .env; the API needs the same value.',
    );
  const keysFile = option(args, '--keys-file');
  const privateJwk = keysFile ? readFileSync(keysFile, 'utf8') : process.env.HALYN_SIGNING_KEY;
  if (!privateJwk)
    throw new Error(
      'No signing key: run `pnpm keys:generate halyn-YYYY-MM` and set HALYN_SIGNING_KEY (or pass --keys-file).',
    );
  const url = tidbUrl(database);
  if (!url) throw new Error('TiDB is not configured: set TIDB_HOST, TIDB_USERNAME and TIDB_PASSWORD in .env');

  const rows = await buildSeed({
    customerPhone,
    phoneHashPepper: pepper,
    signer: await importSigningKey(privateJwk),
    packs: compiledPacks(),
  });
  const db = createDb(url);
  await upsertTenant(db, rows.tenant);
  for (const customer of rows.customers) await upsertCustomer(db, SEED_TENANT, customer);
  for (const pack of rows.policyPacks) await upsertPolicyPack(db, SEED_TENANT, pack);
  await upsertPass(db, SEED_TENANT, rows.pass);
  console.log(
    `✓ seeded ${database}: tenant ${SEED_TENANT}, ${rows.customers.length} customers, ` +
      `${rows.policyPacks.length} policy packs, Pass ${rows.pass.id} (key ${rows.tenant.signing_key_id})` +
      (testNumber ? ' — with a TEST number; re-seed with CUSTOMER_PHONE before real calls' : ''),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
