import { describe, expect, it } from 'vitest';
import { parseSeedCoreArgs, wranglerSteps } from '../../scripts/seed-core';

describe('seed:core', () => {
  it('seeds the local D1 by default', () => {
    expect(parseSeedCoreArgs([])).toBe('local');
    expect(wranglerSteps('local')).toEqual([
      ['wrangler', 'd1', 'migrations', 'apply', 'aero-core', '--local'],
      ['wrangler', 'd1', 'execute', 'aero-core', '--local', '--file', 'seed/seed.sql'],
    ]);
  });

  it('only regenerates the file with --write-only', () => {
    expect(parseSeedCoreArgs(['--write-only'])).toBe('none');
  });

  it('refuses the deployed D1 without --yes', () => {
    expect(() => parseSeedCoreArgs(['--remote'])).toThrow(/--yes/);
    expect(parseSeedCoreArgs(['--remote', '--yes'])).toBe('remote');
    expect(wranglerSteps('remote')[1]).toContain('--remote');
  });

  it('refuses unknown or contradictory options', () => {
    expect(() => parseSeedCoreArgs(['--db', 'halyn'])).toThrow(/unknown option/);
    expect(() => parseSeedCoreArgs(['--write-only', '--remote', '--yes'])).toThrow(/cannot be combined/);
  });
});
