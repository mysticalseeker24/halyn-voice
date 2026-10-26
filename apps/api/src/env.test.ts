import { HalynError } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import {
  DbEnvSchema,
  EnvSchema,
  requireEnv,
  SessionEnvSchema,
  SourceIpsSchema,
  TidbUrlSchema,
  ToolEnvSchema,
} from './env';

const SECRET = 'x'.repeat(32);

describe('env schemas', () => {
  it('parse the Bolna source IP list (trimmed, IPv4 or IPv6, at least one)', () => {
    expect(SourceIpsSchema.parse(' 13.203.39.153, 13.126.9.249 ,')).toEqual([
      '13.203.39.153',
      '13.126.9.249',
    ]);
    expect(SourceIpsSchema.parse('2001:db8::1')).toEqual(['2001:db8::1']);
    for (const bad of ['', ',', '999.1.1.1', '13.203.39', 'localhost'])
      expect(SourceIpsSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('require 32+ character secrets', () => {
    const ips = '13.203.39.153';
    expect(ToolEnvSchema.safeParse({ BOLNA_SOURCE_IPS: ips, HALYN_TOOL_SECRET: SECRET }).success).toBe(true);
    expect(ToolEnvSchema.safeParse({ BOLNA_SOURCE_IPS: ips, HALYN_TOOL_SECRET: 'short' }).success).toBe(
      false,
    );
    expect(
      SessionEnvSchema.safeParse({ SESSION_SECRET: 'x'.repeat(31), DEFAULT_TENANT_ID: 'ten_aero' }).success,
    ).toBe(false);
  });

  it('accept only a mysql:// TiDB URL with a database', () => {
    expect(
      TidbUrlSchema.safeParse('mysql://user.root:p%40ss@gateway01.example.com:4000/halyn_dev').success,
    ).toBe(true);
    for (const bad of ['mysql://u:p@host', 'https://u:p@host/db', 'mysql://host/db', ''])
      expect(DbEnvSchema.safeParse({ TIDB_DATABASE_URL: bad }).success, bad).toBe(false);
  });

  it('cover every group in the full schema', () => {
    const full = {
      BOLNA_SOURCE_IPS: '13.203.39.153',
      HALYN_TOOL_SECRET: SECRET,
      SESSION_SECRET: SECRET,
      DEFAULT_TENANT_ID: 'ten_aero',
      TIDB_DATABASE_URL: 'mysql://u:p@h:4000/halyn',
      HALYN_SIGNING_KEY: '{}',
      HALYN_PUBLIC_JWKS: '{}',
      HALYN_KEY_ID: 'halyn-2026-10',
      PASS_CODE_PEPPER: SECRET,
      PHONE_HASH_PEPPER: SECRET,
      BOLNA_API_KEY: 'bn-x',
      SARVAM_API_KEY: 'sk_x',
      WEB_ORIGIN: 'http://localhost:3000',
      RP_ID: 'localhost',
    };
    expect(EnvSchema.safeParse(full).success).toBe(true);
    const { PHONE_HASH_PEPPER: _drop, ...missing } = full;
    expect(EnvSchema.safeParse(missing).success).toBe(false);
  });
});

describe('requireEnv', () => {
  it('returns the parsed group', () => {
    const env = requireEnv({ BOLNA_SOURCE_IPS: '13.203.39.153', HALYN_TOOL_SECRET: SECRET }, ToolEnvSchema);
    expect(env.BOLNA_SOURCE_IPS).toEqual(['13.203.39.153']);
  });

  it('fails closed without naming which setting is wrong', () => {
    let caught: unknown;
    try {
      requireEnv({ BOLNA_SOURCE_IPS: '13.203.39.153' }, ToolEnvSchema);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HalynError);
    expect((caught as HalynError).code).toBe('E_FAIL_CLOSED');
    expect((caught as HalynError).message).not.toMatch(/HALYN_TOOL_SECRET|BOLNA/);
  });
});
