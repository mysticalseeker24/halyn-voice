import { type ActionId, type Money, formatMoney } from '@halyn/shared';

/** Money is integer minor units; only the shared helper formats it. */
export const money = (value: Money): string => formatMoney(value);

/** Account and card numbers are shown as last 4 only. */
export const maskLast4 = (last4: string | null | undefined): string => (last4 ? `•••• ${last4}` : '—');

/** IST wall-clock time, so screens and screenshots do not depend on the machine's zone. */
export function istTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
}

export function istDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}

export const ACTION_LABELS: Record<ActionId, string> = {
  'account.add_owner': 'Add an account owner',
  'account.close': 'Close an account',
  'balance.view': 'View balance',
  'card.freeze': 'Freeze card',
  'card.reset_pin': 'Reset card PIN',
  'dispute.charge': 'Dispute a charge',
  'emi.move_date': 'Move EMI date',
  'fee.waive': 'Waive a fee',
  'loan.new': 'New loan',
  'profile.change_email': 'Change email',
  'profile.change_mobile': 'Change mobile number',
  'statement.view': 'View statement',
  'transfer.new_payee': 'Transfer to a new payee',
  'transfer.saved': 'Transfer to a saved payee',
  'upi.raise_limit': 'Raise UPI limit',
  'wire.international': 'International wire',
  'wire.new': 'Wire to a new account',
};
