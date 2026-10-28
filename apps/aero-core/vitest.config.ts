import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Every suite runs inside workerd (Miniflare) with the D1 binding from wrangler.toml, the committed migrations
// (applied by test/setup.ts) and a throwaway Ed25519 key pair generated for this run: Aero Core trusts its public JWKS,
// and the tests sign grants with its private half. No real key is ever used in tests.

const TEST_KID = 'test-aero-core';
const pure = { lines: 95, branches: 95, functions: 95, statements: 95 };

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
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Explicit, so a local .dev.vars can never change what the tests trust.
          bindings: {
            AERO_TENANT_ID: 'ten_aero',
            HALYN_PUBLIC_JWKS: JSON.stringify(keys.jwks),
            TEST_SIGNING_KEY: JSON.stringify(keys.privateJwk),
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
      projects: [
        { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], testTimeout: 20_000 } },
        { extends: true, test: { name: 'int', include: ['test/int/**/*.test.ts'], testTimeout: 20_000 } },
      ],
      coverage: {
        // workerd has no V8 inspector: the Workers integration supports Istanbul only.
        provider: 'istanbul',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
        // docs/TESTING.md: ≥ 60% everywhere (speed mode, CLAUDE.md §5); the grant check every write depends on is held to the pure-module bar.
        thresholds: {
          lines: 60,
          branches: 60,
          functions: 60,
          statements: 60,
          'src/grant/**': pure,
          'src/core/commit.ts': pure,
        },
      },
    },
  };
});
