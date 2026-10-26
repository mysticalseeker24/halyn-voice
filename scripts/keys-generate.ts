// pnpm keys:generate [kid] [--force] — create Halyn's Ed25519 signing key (private JWK) and public JWKS.
// Writes scripts/out/keys/<kid>.private.jwk.json and <kid>.jwks.json (scripts/out/ is git-ignored) and prints only the
// kid, the public key and the commands that load them as secrets. The private key is never printed.
import type { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type Ed25519PrivateJwk,
  Ed25519PrivateJwkSchema,
  type Ed25519PublicJwk,
  Ed25519PublicJwkSchema,
} from '@halyn/shared';

export interface KeySet {
  privateJwk: Ed25519PrivateJwk;
  publicJwks: { keys: [Ed25519PublicJwk] };
}

const KID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A fresh Ed25519 key pair as Halyn's private JWK and public JWKS (`kid`, `alg: EdDSA`, `use: sig`). */
export async function generateKeySet(kid: string): Promise<KeySet> {
  if (!KID.test(kid))
    throw new Error(`keys:generate: invalid kid "${kid}" (lower-case letters, digits, dashes)`);
  // Node's typings return CryptoKey | CryptoKeyPair for Ed25519 generateKey; it is always a pair.
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as unknown as webcrypto.CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = Ed25519PublicJwkSchema.parse({
    kty: 'OKP',
    crv: 'Ed25519',
    x: jwk.x,
    kid,
    alg: 'EdDSA',
    use: 'sig',
  });
  return {
    privateJwk: Ed25519PrivateJwkSchema.parse({ ...publicJwk, d: jwk.d }),
    publicJwks: { keys: [publicJwk] },
  };
}

/** `halyn-YYYY-MM`, the kid convention in .env.example. */
export function defaultKid(now: Date): string {
  return `halyn-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface RunIo {
  /** Where the key files go (default scripts/out/keys). */
  outDir?: string;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

const DEFAULT_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'scripts', 'out', 'keys');

/** The CLI. Returns the exit code; prints only the kid, the public key and how to load them. */
export async function run(args: string[], io: RunIo = {}): Promise<number> {
  const log = io.log ?? ((line: string) => console.log(line));
  const error = io.error ?? ((line: string) => console.error(line));
  const force = args.includes('--force');
  const kid = args.find((a) => !a.startsWith('--')) ?? defaultKid(new Date());
  if (!KID.test(kid)) {
    error(`keys:generate: invalid kid "${kid}" (lower-case letters, digits, dashes)`);
    return 1;
  }
  const dir = io.outDir ?? DEFAULT_DIR;
  const privatePath = join(dir, `${kid}.private.jwk.json`);
  const jwksPath = join(dir, `${kid}.jwks.json`);
  if (!force && (existsSync(privatePath) || existsSync(jwksPath))) {
    error(`keys:generate: keys for ${kid} already exist in ${dir} (use --force to replace them)`);
    return 1;
  }
  const keys = await generateKeySet(kid);
  await mkdir(dir, { recursive: true });
  await writeFile(privatePath, `${JSON.stringify(keys.privateJwk)}\n`, { mode: 0o600 });
  await writeFile(jwksPath, `${JSON.stringify(keys.publicJwks)}\n`);
  const priv = `scripts/out/keys/${kid}.private.jwk.json`;
  const pub = `scripts/out/keys/${kid}.jwks.json`;
  log(
    [
      `kid:        ${kid}`,
      `public key: ${keys.privateJwk.x}`,
      `written:    ${priv} (private, never commit) and ${pub}`,
      '',
      'Load them as secrets (from the repo root):',
      `  pnpm --filter @halyn/api exec wrangler secret put HALYN_SIGNING_KEY < ${priv}`,
      `  pnpm --filter @halyn/api exec wrangler secret put HALYN_PUBLIC_JWKS < ${pub}`,
      `  pnpm --filter @halyn/aero-core exec wrangler secret put HALYN_PUBLIC_JWKS < ${pub}`,
      `For wrangler dev, put the same values in apps/api/.dev.vars and apps/aero-core/.dev.vars, and HALYN_KEY_ID=${kid}.`,
    ].join('\n'),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await run(process.argv.slice(2));
