// In-memory twins of policy-packs/aero-in.yaml and aero-us.yaml for unit tests (test/ checks the real files).
// Each call returns a fresh object, so tests can mutate it freely.
import type { PolicyPackInput } from '../policy-pack';

export const PACK_SHA = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

export function aeroInPack(): PolicyPackInput {
  return {
    pack: 'aero-in',
    version: 1,
    region: 'IN',
    currency: 'INR',
    coaching: { threshold: 0.6 },
    confirm: { timeout_seconds: 60, channels: ['passkey', 'callback'] },
    actions: {
      'card.freeze': { tier: 0, protective: true, pass_eligible: true },
      'balance.view': { tier: 0, read: true, pass_eligible: true },
      'statement.view': { tier: 0, read: true, pass_eligible: true },
      'fee.waive': { tier: 1, limit: { amount_minor: 100000, per: 'year', count: 1 }, pass_eligible: true },
      'emi.move_date': { tier: 2, limit: { per: 'year', count: 1 }, pass_eligible: true },
      'transfer.saved': { tier: 2, limit: { amount_minor: 1000000, per: 'day' }, pass_eligible: false },
      'transfer.new_payee': { tier: 3, cap_first_24h_minor: 1000000, pass_eligible: false },
      'upi.raise_limit': { tier: 3, pass_eligible: false },
      'card.reset_pin': { tier: 3, pass_eligible: false },
      'profile.change_mobile': { tier: 4, hold_hours: 24, pass_eligible: false },
      'profile.change_email': { tier: 4, hold_hours: 24, pass_eligible: false },
      'dispute.charge': { perimeter: 'human_only' },
      'account.close': { perimeter: 'human_only' },
      'account.add_owner': { perimeter: 'human_only' },
      'loan.new': { perimeter: 'human_only' },
      'wire.international': { perimeter: 'human_only' },
    },
    signals: {
      unregistered_number: 1,
      calls_last_hour_gte_3: 1,
      unusual_hour: 1,
      liveness_below_0_3: 1,
      transfers_last_10m_gte_2: 1,
    },
    handoff: { specialist_number_env: 'SPECIALIST_NUMBER' },
  };
}

export function aeroUsPack(): PolicyPackInput {
  return {
    pack: 'aero-us',
    version: 1,
    region: 'US',
    currency: 'USD',
    coaching: { threshold: 0.6 },
    confirm: { timeout_seconds: 60, channels: ['passkey'] },
    actions: {
      'card.freeze': { tier: 0, protective: true, pass_eligible: true },
      'balance.view': { tier: 0, read: true, pass_eligible: true },
      'statement.view': { tier: 0, read: true, pass_eligible: true },
      'fee.waive': { tier: 1, limit: { amount_minor: 3500, per: 'year', count: 1 }, pass_eligible: true },
      'transfer.saved': { tier: 2, limit: { amount_minor: 100000, per: 'day' }, pass_eligible: false },
      'wire.new': { tier: 3, human_only_above_minor: 500000, pass_eligible: false },
      'profile.change_mobile': { tier: 4, hold_hours: 24, pass_eligible: false },
      'dispute.charge': { perimeter: 'human_only' },
      'account.close': { perimeter: 'human_only' },
      'wire.international': { perimeter: 'human_only' },
    },
    signals: {
      unregistered_number: 1,
      calls_last_hour_gte_3: 1,
      unusual_hour: 1,
      liveness_below_0_3: 1,
      transfers_last_10m_gte_2: 1,
    },
    handoff: { specialist_number_env: 'SPECIALIST_NUMBER' },
  };
}
