import {
  Ed25519PrivateJwkSchema,
  importSigningKey,
  importVerifyKeys,
  JwksSchema,
  signCompactJws,
  verifyCompactJws,
} from '@halyn/shared';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultKid, generateKeySet, run } from '../../scripts/keys-generate';

describe('keys:generate', () => {
  it('makes a private JWK and a JWKS that round-trip a signature through @halyn/shared', async () => {
    const keys = await generateKeySet('halyn-2026-10');
    expect(Ed25519PrivateJwkSchema.parse(keys.privateJwk)).toMatchObject({
      kid: 'halyn-2026-10',
      alg: 'EdDSA',
      use: 'sig',
    });
    expect(JwksSchema.parse(keys.publicJwks).keys[0]).not.toHaveProperty('d');
    const signer = await importSigningKey(JSON.stringify(keys.privateJwk));
    const token = await signCompactJws(
      { alg: 'EdDSA', kid: signer.kid, typ: 'halyn-grant+jwt' },
      { a: 1 },
      signer.key,
    );
    const verified = await verifyCompactJws(
      token,
      await importVerifyKeys(JSON.stringify(keys.publicJwks)),
      'halyn-grant+jwt',
    );
    expect(verified).toMatchObject({ ok: true, payload: { a: 1 } });
  });

  it('makes a different key every run', async () => {
    const a = await generateKeySet('k1');
    const b = await generateKeySet('k1');
    expect(a.privateJwk.x).not.toBe(b.privateJwk.x);
  });

  it('refuses a kid that is not lower-case letters, digits and dashes', async () => {
    await expect(generateKeySet('Halyn 2026')).rejects.toThrow(/invalid kid/);
  });

  it('defaults the kid to halyn-YYYY-MM (UTC)', () => {
    expect(defaultKid(new Date(Date.UTC(2026, 9, 31, 23, 0)))).toBe('halyn-2026-10');
    expect(defaultKid(new Date(Date.UTC(2027, 0, 1)))).toBe('halyn-2027-01');
  });
});

// The CLI, run against a temporary folder with its output captured: the private key must never reach the terminal.
describe('keys:generate CLI', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function cli(args: string[]) {
    const outDir = await mkdtemp(join(tmpdir(), 'halyn-keys-'));
    dirs.push(outDir);
    const lines: string[] = [];
    const io = { outDir, log: (s: string) => lines.push(s), error: (s: string) => lines.push(s) };
    return { outDir, lines, io, code: await run(args, io) };
  }

  it('writes both files and prints the kid and public key but never the private key', async () => {
    const { outDir, lines, code } = await cli(['test-kid']);
    expect(code).toBe(0);
    const priv = Ed25519PrivateJwkSchema.parse(
      JSON.parse(await readFile(join(outDir, 'test-kid.private.jwk.json'), 'utf8')),
    );
    const jwks = JwksSchema.parse(JSON.parse(await readFile(join(outDir, 'test-kid.jwks.json'), 'utf8')));
    const output = lines.join('\n');
    expect(output).toContain('test-kid');
    expect(output).toContain(priv.x);
    expect(output).not.toContain(priv.d);
    expect(jwks.keys[0]?.x).toBe(priv.x);
    if (process.platform !== 'win32') {
      expect((await stat(join(outDir, 'test-kid.private.jwk.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses to overwrite existing keys without --force, and replaces them with it', async () => {
    const first = await cli(['test-kid']);
    const path = join(first.outDir, 'test-kid.private.jwk.json');
    const before = await readFile(path, 'utf8');
    expect(await run(['test-kid'], first.io)).toBe(1);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(first.lines.join('\n')).toMatch(/already exist/);
    expect(await run(['test-kid', '--force'], first.io)).toBe(0);
    expect(await readFile(path, 'utf8')).not.toBe(before);
  });

  it('rejects an invalid kid with exit code 1 and writes nothing', async () => {
    const { outDir, lines, code } = await cli(['Bad Kid!']);
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/invalid kid/);
    await expect(stat(join(outDir, 'Bad Kid!.private.jwk.json'))).rejects.toThrow();
  });
});
