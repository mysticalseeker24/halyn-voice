# Actions — the catalog

Every action an agent can propose. Params are **strict** Zod schemas in `packages/shared/src/actions.ts`: unknown keys are
rejected, because the grant's `params_hash` binds the exact parameters Aero Core executes. Tiers come from
`policy-packs/*.yaml`. `packages/shared/test/actions-doc.contract.test.ts` checks this table against the code and both
packs, and the Aero Core column against `CORE_ROUTES` (`packages/shared/src/core.ts`), so a change to any of them must
update this file. GET routes take the params as the query string, POST routes as the JSON body (docs/API.md).

| Action | Params | Kind | Moves money | Critical | IN | US | Aero Core | Scenarios |
|---|---|---|---|---|---|---|---|---|
| `account.add_owner` | `account`, `owner_name` | write | no | yes | human | — | — | — |
| `account.close` | `account` | write | no | yes | human | human | — | 9 |
| `balance.view` | `account` | read | no | no | 0 | 0 | `GET /core/balance` | 7 |
| `card.freeze` | `card_last4` | protective | no | no | 0 | 0 | `POST /core/cards/freeze` | 1 |
| `card.reset_pin` | `card_last4` | write | no | no | 3 | — | — | — |
| `dispute.charge` | `card_last4`, `amount_minor`, `currency`, `merchant` | write | no | no | human | human | — | — |
| `emi.move_date` | `loan_id`, `new_day` | write | no | no | 2 | — | `POST /core/loans/emi-date` | 5 |
| `fee.waive` | `amount_minor`, `currency`, `fee_id` | write | no | no | 1 | 1 | `POST /core/fees/waive` | 2 |
| `loan.new` | `amount_minor`, `currency`, `tenure_months` | write | yes | no | human | — | — | — |
| `profile.change_email` | `new_email` | write | no | yes | 4 | — | — | — |
| `profile.change_mobile` | `new_number` | write | no | yes | 4 | 4 | — | — |
| `statement.view` | `account` | read | no | no | 0 | 0 | `GET /core/statement` | 5 |
| `transfer.new_payee` | `amount_minor`, `currency`, `payee_account_last4`, `payee_ifsc`, `payee_name?` | write | yes | yes | 3 | — | `POST /core/transfers` | 3, 3b, 4, 6, 10, 11 |
| `transfer.saved` | `amount_minor`, `currency`, `payee_id` | write | yes | no | 2 | 2 | `POST /core/transfers` | 8, 12 |
| `upi.raise_limit` | `amount_minor`, `currency` | write | yes | no | 3 | — | — | — |
| `wire.international` | `amount_minor`, `currency`, `payee_account_last4`, `swift_bic`, `payee_country` | write | yes | yes | human | human | — | — |
| `wire.new` | `amount_minor`, `currency`, `payee_account_last4`, `routing_last4` | write | yes | yes | — | 3 | `POST /core/transfers` | 10 |

Legend: `0`–`4` = base tier in that region's pack · `human` = `perimeter: human_only` (always `hold` → specialist) ·
`—` = not offered in that region (the Gate denies) · `?` = optional param.

## Param formats
| Param | Format |
|---|---|
| `account` | `savings` · `current` · `checking` (the customer's own account, by type) |
| `amount_minor` + `currency` | positive integer minor units (paise / cents) + `INR` · `USD`; the currency must match the pack |
| `card_last4`, `payee_account_last4`, `routing_last4` | exactly 4 digits |
| `fee_id`, `loan_id`, `payee_id` | Halyn ids (`fee_late_oct`, `loan_personal_1`, `payee_mom`) |
| `payee_ifsc` | IFSC: 4 letters, `0`, 6 letters/digits (`AERO0000001`) |
| `swift_bic` · `payee_country` | 8 or 11 character BIC · ISO 3166 alpha-2 |
| `new_day` | day of month 1–28 (exists in every month) |
| `tenure_months` | 1–360 |
| `new_number` · `new_email` | E.164 · e-mail address (≤ 254 chars) |
| `owner_name`, `merchant`, `payee_name` | 1–80 characters of free text |

## Rules behind the shapes
- **No full numbers.** Params carry last-4 digits, payee ids and bank codes, never a full card or account number.
  A PIN, OTP or CVV is never a param: `card.reset_pin` only identifies the card; the new PIN is set in the Aero app.
- **Speakable.** The agent reads the params back and hears a clear yes before proposing (`readback_confirmed`), so
  every param must be something a person can confirm aloud.
- **`profile.change_mobile` carries the full new number** because the bank needs it to make the change; logs mask it
  to the last 4. It is tier 4 and critical: the step-up goes to the *current* registered number, then a 24 h delay.
- **`upi.raise_limit`'s amount is the new daily UPI limit**, not a payment. It counts as money-moving because raising
  the limit is the usual first step of a coached transfer, so coaching ≥ threshold holds it.
- **`dispute.charge` is identified by card, amount and merchant** (what a caller can say). It is human-only, so the
  specialist finds the exact transaction.

## Actions with no Aero Core route
`upi.raise_limit`, `card.reset_pin`, `profile.change_mobile` and `profile.change_email` are agent-tier actions that
no scenario uses and Aero Core does not implement. The Gate decides them like any other action. If one is approved,
Halyn creates a handoff for a specialist to complete it, because there is nothing to execute (Step 7 wires this).
Human-only actions never reach Aero Core from the agent at all.
