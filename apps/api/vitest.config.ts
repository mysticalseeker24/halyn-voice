import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { loadDotEnv, tidbUrl } from '../../scripts/lib/tidb.ts';

// Every suite runs inside workerd (Miniflare) with the bindings from wrangler.toml, plus test-only secrets.
const pure = { lines: 95, branches: 95 };

// The DB suite (ADR-013) runs against TiDB's halyn_test database when credentials exist (local .env, or the CI
// secret TIDB_TEST_DATABASE_URL); otherwise it skips with a warning. Every other suite is offline.
loadDotEnv();
const testDatabaseUrl = tidbUrl('halyn_test') ?? '';

const TEST_KID = 'test-halyn';

/** A throwaway Ed25519 key pair per run: the API signs grants and Passes with it, Aero Core (in-process) trusts it. */
async function throwawayKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: TEST_KID, alg: 'EdDSA', use: 'sig' };
  return { jwks: { keys: [publicJwk] }, privateJwk: { ...publicJwk, d: jwk.d } };
}

export default defineConfig(async () => {
  const keys = await throwawayKeys();
  // Aero Core's committed D1 migrations: the scenario runner and integration tests run the real Aero Core app
  // in-process against this Miniflare D1 (test/fixtures/aero-core.ts).
  const aeroMigrations = await readD1Migrations(
    fileURLToPath(new URL('../aero-core/migrations', import.meta.url)),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: { AERO_DB: 'aero-core-test' },
          // wrangler.toml binds AERO_CORE to the deployed Aero Core Worker; tests run the real Aero Core in-process
          // instead (test/fixtures/aero-core.ts), so the binding only answers that it is not used.
          serviceBindings: {
            AERO_CORE: () => new Response('Aero Core runs in-process in tests', { status: 503 }),
          },
          bindings: {
            HALYN_TOOL_SECRET: 'test-tool-secret-0123456789abcdef0123456789',
            SESSION_SECRET: 'test-session-secret-0123456789abcdef01234567',
            TIDB_TEST_DATABASE_URL: testDatabaseUrl,
            // Read by the Hub itself (it has no request env): peppers and keys are test-only values.
            PASS_CODE_PEPPER: 'test-pass-pepper-0123456789abcdef0123456789',
            PHONE_HASH_PEPPER: 'test-phone-pepper-0123456789abcdef012345678',
            HALYN_SIGNING_KEY: JSON.stringify(keys.privateJwk),
            HALYN_PUBLIC_JWKS: JSON.stringify(keys.jwks),
            HALYN_KEY_ID: TEST_KID,
            BOLNA_API_KEY: 'bn-test-key-not-real',
            // Tests never reach Bolna or TiDB by accident (apps/api/.dev.vars is loaded too): a dead host, no database.
            BOLNA_API_BASE: 'https://bolna.test.invalid',
            TIDB_DATABASE_URL: '',
            SARVAM_API_KEY: '',
            CUSTOMER_PHONE: '+919000000003',
            NUMBER_B: '+918065356379',
            BOLNA_CONFIRM_AGENT_ID: '00000000-0000-4000-8000-00000000c0f1',
            AERO_CORE_URL: 'https://aero-core.test.invalid',
            TEST_AERO_MIGRATIONS: aeroMigrations,
          },
        },
      }),
    ],
    test: {
      projects: [
        { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], testTimeout: 20_000 } },
        // Worker and Durable Object start-up (and TiDB round trips) need more than the default 5 s on a busy machine.
        {
          extends: true,
          test: {
            name: 'int',
            include: ['test/int/**/*.test.ts', 'test/contract/**/*.test.ts'],
            testTimeout: 20_000,
          },
        },
        {
          extends: true,
          test: {
            name: 'db',
            include: ['test/db/**/*.test.ts'],
            globalSetup: ['../../scripts/test-db-setup.ts'],
            testTimeout: 30_000,
          },
        },
        {
          extends: true,
          test: { name: 'scenarios', include: ['test/scenarios/**/*.test.ts'], testTimeout: 30_000 },
        },
      ],
      coverage: {
        // workerd has no V8 inspector: the Workers integration supports Istanbul only.
        provider: 'istanbul',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
        // docs/TESTING.md: ≥ 95% lines and branches for the pure core, ≥ 80% elsewhere.
        thresholds: {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
          'src/gate/**': pure,
          'src/grants/**': pure,
          'src/ledger/**': pure,
          'src/pass/**': pure,
          'src/signals/*-lexicon.ts': pure,
        },
      },
    },
  };
});
