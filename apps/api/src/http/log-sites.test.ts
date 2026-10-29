import { afterEach, describe, expect, it, vi } from 'vitest';
import { logLine } from './errors';

// Log-masking audit (Step 16): every log line goes through a masking logger, so no full phone or account number can
// reach the Worker logs from an error message. Only these modules may call console themselves.
const LOGGERS = new Set(['./errors.ts', '../bolna/client.ts', '../../../aero-core/src/http/errors.ts']);

const SOURCES = import.meta.glob<string>(
  [
    '../**/*.ts',
    '../../../aero-core/src/**/*.ts',
    '!../**/*.test.ts',
    '!../../../aero-core/src/**/*.test.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
);

describe('log sites', () => {
  afterEach(() => vi.restoreAllMocks());

  it('only the masking loggers call console directly', () => {
    const files = Object.keys(SOURCES);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files
      .filter((path) => !LOGGERS.has(path))
      .filter((path) => /console\.(log|error|warn|info|debug)\(/.test(SOURCES[path] ?? ''));
    expect(offenders).toEqual([]);
  });

  it('logLine masks a phone number inside an error detail', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logLine({ level: 'error', detail: 'callback to +919000000003 refused' });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toContain('9000000003');
    expect(line).toContain('0003');
  });
});
