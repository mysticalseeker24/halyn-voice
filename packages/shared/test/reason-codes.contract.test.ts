import { describe, expect, it } from 'vitest';
import { isReasonCode, REASON_CODES } from '../src/index';
import { readRepoFile } from './repo';

// A code is a prefix letter, an underscore and upper-case words; "E_GRANT_*" style wildcards are not codes.
const CODE = /\b[PSTHXIRCE]_[A-Z0-9_]*[A-Z0-9]\b/g;

describe('reason codes vs docs', () => {
  it('match the complete list in docs/GATE.md exactly', () => {
    const section = readRepoFile('docs/GATE.md')
      .split(/^## /m)
      .find((s) => s.startsWith('Reason codes'));
    expect(section).toBeDefined();
    const documented = new Set(section?.match(CODE));
    expect([...documented].sort()).toEqual([...REASON_CODES].sort());
  });

  it.each(['docs/GATE.md', 'docs/SCENARIOS.md', 'docs/API.md', 'docs/ARCHITECTURE.md', 'docs/PASS.md'])(
    'every code mentioned in %s exists',
    (file) => {
      const unknown = (readRepoFile(file).match(CODE) ?? []).filter((c) => !isReasonCode(c));
      expect(unknown).toEqual([]);
    },
  );
});
