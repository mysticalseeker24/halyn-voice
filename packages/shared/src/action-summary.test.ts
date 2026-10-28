import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { describeAction } from './action-summary';
import { ACTION_IDS, type ActionId, parseActionParams } from './actions';
import { maskNumbers } from './mask';

const SAMPLE: Record<ActionId, Record<string, unknown>> = {
  'account.add_owner': { account: 'savings', owner_name: 'Asha' },
  'account.close': { account: 'savings' },
  'balance.view': { account: 'savings' },
  'card.freeze': { card_last4: '8812' },
  'card.reset_pin': { card_last4: '8812' },
  'dispute.charge': { card_last4: '8812', amount_minor: 129900, currency: 'INR', merchant: 'Shop' },
  'emi.move_date': { loan_id: 'loan_personal_1', new_day: 10 },
  'fee.waive': { amount_minor: 60000, currency: 'INR', fee_id: 'fee_late_oct' },
  'loan.new': { amount_minor: 10000000, currency: 'INR', tenure_months: 24 },
  'profile.change_email': { new_email: 'a@example.com' },
  'profile.change_mobile': { new_number: '+919000000002' },
  'statement.view': { account: 'savings' },
  'transfer.new_payee': {
    amount_minor: 4500000,
    currency: 'INR',
    payee_account_last4: '4471',
    payee_ifsc: 'AERO0000001',
  },
  'transfer.saved': { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' },
  'upi.raise_limit': { amount_minor: 10000000, currency: 'INR' },
  'wire.international': {
    amount_minor: 800000,
    currency: 'USD',
    payee_account_last4: '3310',
    swift_bic: 'AEROUS33',
    payee_country: 'US',
  },
  'wire.new': { amount_minor: 800000, currency: 'USD', payee_account_last4: '3310', routing_last4: '0021' },
};

function proposed(action: ActionId, params = SAMPLE[action]) {
  const parsed = parseActionParams(action, params);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe('describeAction', () => {
  it.each(ACTION_IDS)('%s: one sentence, ≤ 300 chars, no unmasked number', (action) => {
    const text = describeAction(proposed(action));
    expect(text.length).toBeGreaterThan(5);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(maskNumbers(text)).toBe(text);
  });

  it('says the amount, the payee and the last 4 digits a customer must check', () => {
    expect(describeAction(proposed('transfer.new_payee'))).toBe(
      'Send ₹45,000 to a NEW payee, account ending 4471 (AERO0000001)',
    );
    expect(
      describeAction(
        proposed('transfer.new_payee', {
          ...SAMPLE['transfer.new_payee'],
          payee_name: 'Verification account',
        }),
      ),
    ).toContain('named "Verification account"');
    expect(describeAction(proposed('card.freeze'))).toBe('Freeze the card ending 8812');
    expect(describeAction(proposed('transfer.saved'))).toBe('Send ₹4,900 to the saved payee "landlord"');
    expect(describeAction(proposed('fee.waive'))).toBe('Waive the ₹600 fee (late oct)');
    expect(describeAction(proposed('emi.move_date'))).toBe(
      'Move the EMI of loan personal 1 to day 10 of each month',
    );
    expect(describeAction(proposed('wire.new'))).toContain('$8,000');
    expect(describeAction(proposed('profile.change_mobile'))).toBe(
      'Change the registered mobile number to one ending 0002',
    );
  });

  it('stays within 300 characters for any free text', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (name) => {
        const parsed = parseActionParams('account.add_owner', { account: 'current', owner_name: name });
        if (!parsed.ok) return;
        expect(describeAction(parsed.value).length).toBeLessThanOrEqual(300);
      }),
      { seed: 3, numRuns: 100 },
    );
    const long = proposed('account.add_owner', { account: 'savings', owner_name: 'x'.repeat(80) });
    expect(describeAction(long).length).toBeLessThanOrEqual(300);
  });
});
