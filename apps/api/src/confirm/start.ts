import { HalynError } from '@halyn/shared';
import { ConfirmEnvSchema, PhoneEnvSchema, requireEnv } from '../env';
import { registeredNumberHash } from '../db/numbers';
import type { FlowContext } from '../flow/context';
import type { RequestRecord } from '../hub/types';

// The Confirm callback leg (docs/ARCHITECTURE.md "Confirmation"): Bolna's Confirm agent rings the customer's
// registered phone from number B and reads back the exact action; its `confirm_result` tool answers. It runs in
// parallel with the passkey leg (the Hub already pushed `confirm_request` to the Aero app); the first answer wins in
// the Hub (invariant 10). Rules: never outside 09:00–21:00 IST, only to the one number Saksham owns (CUSTOMER_PHONE)
// and only when that number IS the customer's registered number (by hash), never `bypass_call_guardrails`.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** 09:00 ≤ India time < 21:00 — the guardrail window every outbound agent also carries (docs/COMPLIANCE.md). */
export function inCallingWindow(nowMs: number): boolean {
  const hour = new Date(nowMs + IST_OFFSET_MS).getUTCHours();
  return hour >= 9 && hour < 21;
}

/** Whether the callback can ring now, and the hash of the only number it may ring (for the Hub to compare). */
export async function callbackAvailability(
  ctx: FlowContext,
): Promise<{ available: boolean; number_hash: string | null }> {
  const confirm = ConfirmEnvSchema.safeParse(ctx.env);
  const phone = PhoneEnvSchema.safeParse(ctx.env);
  if (!confirm.success || !phone.success || !ctx.bolna) return { available: false, number_hash: null };
  const number_hash = await registeredNumberHash(phone.data.PHONE_HASH_PEPPER, confirm.data.CUSTOMER_PHONE);
  return { available: inCallingWindow(ctx.clock.nowMs()), number_hash };
}

/** Bolna `{{language}}` for the Confirm agent's prompt. */
function spokenLanguage(language: 'hi' | 'en'): string {
  return language === 'hi' ? 'Hinglish' : 'English';
}

/**
 * Place the Confirm call for a step-up that offers the callback channel. On any failure the channel is dropped (the
 * passkey still works, and the 60 s timeout still denies). Returns the Bolna execution id, or null.
 */
export async function startCallback(
  ctx: FlowContext,
  record: RequestRecord,
  customer: { spoken_name: string; language: 'hi' | 'en' } | null,
): Promise<string | null> {
  if (!record.confirm?.channels.includes('callback')) return null;
  try {
    if (!ctx.bolna || !customer) throw new HalynError('E_FAIL_CLOSED', 'confirm: callback not possible');
    const env = requireEnv(ctx.env, ConfirmEnvSchema);
    if (!inCallingWindow(ctx.clock.nowMs()))
      throw new HalynError('E_FAIL_CLOSED', 'confirm: outside 09:00–21:00 IST');
    const { execution_id } = await ctx.bolna.startCall({
      agent_id: env.BOLNA_CONFIRM_AGENT_ID,
      recipient_phone_number: env.CUSTOMER_PHONE,
      from_phone_number: env.NUMBER_B,
      user_data: {
        // The spoken form (Devanagari for Saksham): Sarvam reads Roman "Saksham" wrong (CLAUDE.md §8).
        customer_name: customer.spoken_name,
        action_summary: record.summary,
        request_id: record.request_id,
        language: spokenLanguage(customer.language),
        purpose: 'confirmation',
        timezone: 'Asia/Kolkata',
      },
    });
    await ctx.hub.attachCallback(record.request_id, execution_id);
    return execution_id;
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        component: 'confirm',
        request_id: record.request_id,
        result: 'callback_not_placed',
        detail: err instanceof Error ? err.message.slice(0, 200) : 'error',
      }),
    );
    await ctx.hub.attachCallback(record.request_id, null).catch(() => true);
    return null;
  }
}
