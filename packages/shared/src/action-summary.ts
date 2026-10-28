import type { ProposedAction } from './actions';
import { formatMoney } from './money';

// One plain sentence per proposed action: what the customer is asked to confirm (the Aero app's approval sheet, the
// Confirm agent's `action_summary`, the Stage) and what Aero says back. Never a full account, card or phone number:
// params only carry last-4 digits and ids (docs/ACTIONS.md), and profile.change_mobile's new number is cut to its last
// 4 here. English; the agents translate when they speak. No customer names (TTS must write names in Devanagari).

function money(params: { amount_minor: number; currency: 'INR' | 'USD' }): string {
  return formatMoney({ amount_minor: params.amount_minor, currency: params.currency });
}

function idWords(id: string, prefix: string): string {
  return id.replace(new RegExp(`^${prefix}_`), '').replaceAll('_', ' ');
}

function describe(p: ProposedAction): string {
  switch (p.action) {
    case 'account.add_owner':
      return `Add ${p.params.owner_name} as an owner of the ${p.params.account} account`;
    case 'account.close':
      return `Close the ${p.params.account} account`;
    case 'balance.view':
      return `Share the ${p.params.account} account balance`;
    case 'card.freeze':
      return `Freeze the card ending ${p.params.card_last4}`;
    case 'card.reset_pin':
      return `Reset the PIN of the card ending ${p.params.card_last4}`;
    case 'dispute.charge':
      return `Dispute a ${money(p.params)} charge from ${p.params.merchant} on the card ending ${p.params.card_last4}`;
    case 'emi.move_date':
      return `Move the EMI of loan ${idWords(p.params.loan_id, 'loan')} to day ${p.params.new_day} of each month`;
    case 'fee.waive':
      return `Waive the ${money(p.params)} fee (${idWords(p.params.fee_id, 'fee')})`;
    case 'loan.new':
      return `Open a new ${money(p.params)} loan over ${p.params.tenure_months} months`;
    case 'profile.change_email':
      return 'Change the registered e-mail address';
    case 'profile.change_mobile':
      return `Change the registered mobile number to one ending ${p.params.new_number.slice(-4)}`;
    case 'statement.view':
      return `Share the recent ${p.params.account} account statement`;
    case 'transfer.new_payee': {
      const name = p.params.payee_name ? ` named "${p.params.payee_name}"` : '';
      return `Send ${money(p.params)} to a NEW payee${name}, account ending ${p.params.payee_account_last4} (${p.params.payee_ifsc})`;
    }
    case 'transfer.saved':
      return `Send ${money(p.params)} to the saved payee "${idWords(p.params.payee_id, 'payee')}"`;
    case 'upi.raise_limit':
      return `Raise the daily UPI limit to ${money(p.params)}`;
    case 'wire.international':
      return `Wire ${money(p.params)} abroad (${p.params.payee_country}) to account ending ${p.params.payee_account_last4}`;
    case 'wire.new':
      return `Wire ${money(p.params)} to a NEW account ending ${p.params.payee_account_last4} (routing ending ${p.params.routing_last4})`;
  }
}

/** The sentence for a validated proposal. Free-text params are ≤ 80 chars each, so it stays well under 300. */
export function describeAction(proposed: ProposedAction): string {
  return describe(proposed);
}

/**
 * The summary as a voice should say it: last-4 digits after "ending" spaced out ("ending 8 8 1 2"), so TTS reads
 * them digit by digit instead of as a number (Sarvam read "8812" as a number in a Day-0 voice sample). Amounts stay.
 */
export function spokenSummary(summary: string): string {
  return summary.replace(/\bending (\d+)/g, (_m, digits: string) => `ending ${digits.split('').join(' ')}`);
}
