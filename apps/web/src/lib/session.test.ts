import { describe, expect, it } from 'vitest';
import { sessionBody } from '@/test/fixtures';
import { parseCachedSession } from './session';

const NOW = Date.parse('2026-10-28T09:00:00.000Z');
const CUSTOMER = { kind: 'customer', customerId: 'cus_saksham' } as const;

describe('parseCachedSession', () => {
  it('uses a valid cached session for the same visitor', () => {
    const session = sessionBody('customer');
    expect(parseCachedSession(JSON.stringify(session), CUSTOMER, NOW)).toEqual(session);
    const consoleSession = sessionBody('console');
    expect(parseCachedSession(JSON.stringify(consoleSession), { kind: 'console' }, NOW)).toEqual(
      consoleSession,
    );
  });

  it('signs in again when the cache is missing, not JSON, or not a session', () => {
    expect(parseCachedSession(null, CUSTOMER, NOW)).toBeNull();
    expect(parseCachedSession('{not json', CUSTOMER, NOW)).toBeNull();
    expect(parseCachedSession(JSON.stringify({ ...sessionBody(), token: 1 }), CUSTOMER, NOW)).toBeNull();
    expect(parseCachedSession(JSON.stringify({ ...sessionBody(), extra: true }), CUSTOMER, NOW)).toBeNull();
  });

  it("never reuses another customer's or another kind's session", () => {
    const other = { ...sessionBody('customer'), customer_id: 'cus_other' };
    expect(parseCachedSession(JSON.stringify(other), CUSTOMER, NOW)).toBeNull();
    expect(parseCachedSession(JSON.stringify(sessionBody('console')), CUSTOMER, NOW)).toBeNull();
  });

  it('signs in again when less than a minute is left', () => {
    const soon = { ...sessionBody(), expires_at: new Date(NOW + 59_000).toISOString() };
    expect(parseCachedSession(JSON.stringify(soon), CUSTOMER, NOW)).toBeNull();
    const later = { ...sessionBody(), expires_at: new Date(NOW + 61_000).toISOString() };
    expect(parseCachedSession(JSON.stringify(later), CUSTOMER, NOW)).toEqual(later);
  });
});
