import { HalynError } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { testEnv } from '../test/fixtures/env';
import { requireCoreEnv } from './env';

const valid = () => ({
  DB: testEnv().DB,
  AERO_TENANT_ID: 'ten_aero',
  HALYN_PUBLIC_JWKS: testEnv().HALYN_PUBLIC_JWKS,
});

describe('requireCoreEnv', () => {
  it('parses the database, tenant and public JWKS', () => {
    const env = requireCoreEnv(valid());
    expect(env.tenant).toBe('ten_aero');
    expect(env.db).toBe(testEnv().DB);
    expect(env.jwks.keys).toHaveLength(1);
  });

  it('reuses the parsed JWKS object while the secret is unchanged (so the SDK key cache applies)', () => {
    expect(requireCoreEnv(valid()).jwks).toBe(requireCoreEnv(valid()).jwks);
  });

  const publicKey = (JSON.parse(testEnv().HALYN_PUBLIC_JWKS) as { keys: Record<string, unknown>[] }).keys[0];
  it.each([
    ['no database', { DB: undefined }],
    ['no JWKS', { HALYN_PUBLIC_JWKS: undefined }],
    ['an empty JWKS', { HALYN_PUBLIC_JWKS: '' }],
    ['a JWKS that is not JSON', { HALYN_PUBLIC_JWKS: '{nope' }],
    ['a JWKS with no keys', { HALYN_PUBLIC_JWKS: '{"keys":[]}' }],
    [
      'a JWKS holding a private key',
      { HALYN_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicKey, d: publicKey?.x }] }) },
    ],
    ['no tenant', { AERO_TENANT_ID: undefined }],
    ['a malformed tenant', { AERO_TENANT_ID: 'aero' }],
  ])('%s → E_FAIL_CLOSED, naming nothing', (_, patch) => {
    let error: unknown;
    try {
      requireCoreEnv({ ...valid(), ...patch });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(HalynError);
    expect(error).toMatchObject({ code: 'E_FAIL_CLOSED', message: 'Service configuration is incomplete' });
  });

  it('a non-object env fails closed', () => {
    expect(() => requireCoreEnv(undefined)).toThrow(HalynError);
  });
});
