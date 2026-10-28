import {
  type ActionId,
  ActionIdSchema,
  type CompiledPolicyPack,
  type OutcomeEvent,
  type ReasonCode,
  type Region,
} from '@halyn/shared';
import type { GateContext } from '../gate';
import type { DirectoryCustomer, RequestRecord } from './types';

// Pure helpers the Hub uses to build the Gate's context from its own rows (docs/GATE.md "Inputs"): per-period usage,
// velocity, Pass uses, the unusual-hour signal, name matching for lookup_customer, and which event a request's state
// means. No I/O; time comes in as numbers.

const TEN_MINUTES = 10 * 60 * 1000;

/** The customer's local time zone per region (limits are per local day/month/year; GATE.md unusual hour). */
export const REGION_TIME_ZONE: Record<Region, string> = { IN: 'Asia/Kolkata', US: 'America/New_York' };

function localParts(
  nowMs: number,
  region: Region,
): { year: string; month: string; day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: REGION_TIME_ZONE[region],
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(nowMs);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: Number(get('hour')) };
}

/** The local period an instant falls in: `2026`, `2026-10` or `2026-10-28`. */
export function periodKey(nowMs: number, region: Region, per: 'day' | 'month' | 'year'): string {
  const { year, month, day } = localParts(nowMs, region);
  if (per === 'year') return year;
  return per === 'month' ? `${year}-${month}` : `${year}-${month}-${day}`;
}

/** 23:00–06:00 in the customer's local time (GATE.md, policy pack `unusual_hour`). */
export function unusualHour(nowMs: number, region: Region): boolean {
  const { hour } = localParts(nowMs, region);
  return hour >= 23 || hour < 6;
}

const HALF_HOUR = 30 * 60 * 1000;

/**
 * When a coaching or distress hold's check-in call is booked: the first half hour at least 20 h later that falls in
 * 10:00–18:59 local time. A record only (scenario 4) — no call is placed unless Saksham approves one.
 */
export function checkinTime(nowMs: number, region: Region): number {
  let at = Math.ceil((nowMs + 20 * 60 * 60 * 1000) / HALF_HOUR) * HALF_HOUR;
  for (let i = 0; i < 48; i++) {
    const { hour } = localParts(at, region);
    if (hour >= 10 && hour < 19) break;
    at += HALF_HOUR;
  }
  return at;
}

/**
 * An action that went through (allowed now or approved later) and was not refused by the bank afterwards. An unknown
 * bank outcome (failed with a reconcile handoff open, ADR-020) may have executed, so it counts: limits only get stricter.
 */
export function countsAsUsed(record: RequestRecord): boolean {
  const allowed = record.decision.outcome === 'allow' || record.final_outcome === 'allow';
  if (!allowed) return false;
  if (record.status === 'failed') return record.handoff_id !== null;
  return record.status !== 'held' && record.status !== 'refused';
}

const TRANSFERS = /^(transfer|wire)\./;

/** Counters for the Gate from this customer's earlier requests (GATE.md clarification 8). */
export function gateCounters(
  records: readonly RequestRecord[],
  customer_id: string | null,
  pack: CompiledPolicyPack,
  nowMs: number,
): GateContext['counters'] {
  const per_action_period: GateContext['counters']['per_action_period'] = {};
  let transfers_last_10m = 0;
  if (customer_id === null) return { per_action_period, transfers_last_10m };
  for (const record of records) {
    if (record.customer_id !== customer_id || !countsAsUsed(record)) continue;
    if (TRANSFERS.test(record.action) && nowMs - record.created_at < TEN_MINUTES) transfers_last_10m += 1;
    const action = ActionIdSchema.safeParse(record.action);
    if (!action.success) continue;
    const policy = pack.actions[action.data];
    const limit = policy?.perimeter === 'agent' ? policy.limit : null;
    if (!limit) continue;
    if (periodKey(record.created_at, pack.region, limit.per) !== periodKey(nowMs, pack.region, limit.per))
      continue;
    const used = per_action_period[action.data] ?? { count: 0, amount_minor: 0 };
    per_action_period[action.data] = {
      count: used.count + 1,
      amount_minor: used.amount_minor + (record.gate.amount?.amount_minor ?? 0),
    };
  }
  return { per_action_period, transfers_last_10m };
}

/** How often each action was used through one Pass (scope `max_uses`). */
export function passUses(
  records: readonly RequestRecord[],
  pass_id: string,
): Partial<Record<ActionId, number>> {
  const uses: Partial<Record<ActionId, number>> = {};
  for (const record of records) {
    if (record.pass_id !== pass_id || record.gate.proof !== 'pass' || !countsAsUsed(record)) continue;
    const action = ActionIdSchema.safeParse(record.action);
    if (action.success) uses[action.data] = (uses[action.data] ?? 0) + 1;
  }
  return uses;
}

/** NFKC, lower case, letters/digits/spaces only, single spaces. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The customer a caller names, in the call's region: the full name or the spoken name exactly (after normalising),
 * or a first name that only one customer has. Matching a name is never proof (the number or a Pass is): it only lets
 * the Gate know whose devices a step-up goes to.
 */
export function customerByName(
  customers: readonly DirectoryCustomer[],
  claimed: string,
  region: Region,
): DirectoryCustomer | null {
  const name = normalizeName(claimed);
  if (!name) return null;
  const inRegion = customers.filter((c) => c.region === region);
  const exact = inRegion.filter(
    (c) => normalizeName(c.name) === name || normalizeName(c.spoken_name) === name,
  );
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const first = name.split(' ')[0];
  const byFirst = inRegion.filter(
    (c) =>
      normalizeName(c.name).split(' ')[0] === first || normalizeName(c.spoken_name).split(' ')[0] === first,
  );
  return byFirst.length === 1 ? (byFirst[0] ?? null) : null;
}

const PRIMARY: readonly ReasonCode[] = [
  'E_FAIL_CLOSED',
  'E_CORE_REJECTED',
  'R_READBACK_NOT_CONFIRMED',
  'T_DISTRESS',
  'P_HUMAN_ONLY',
  'P_HUMAN_ONLY_ABOVE_LIMIT',
  'S_COACHING',
  'C_DECLINED',
  'C_TIMEOUT',
  'I_NO_PROOF',
  'P_OVER_LIMIT',
  'H_SPECIALIST',
];

/** The one reason a refusal or hold event carries: the code that decided it. */
export function primaryReason(reasons: readonly ReasonCode[]): ReasonCode {
  return PRIMARY.find((code) => reasons.includes(code)) ?? reasons.at(-1) ?? 'E_FAIL_CLOSED';
}

/** The first event a proposal's call receives (docs/API.md "Events"). */
export function proposalEvent(
  record: Pick<RequestRecord, 'request_id' | 'decision' | 'confirm'>,
): OutcomeEvent {
  const { request_id, decision } = record;
  switch (decision.outcome) {
    case 'allow':
      return { event: 'allow', properties: { request_id } };
    case 'step_up':
      return {
        event: 'step_up',
        properties: { request_id, channels: record.confirm?.channels ?? ['passkey'] },
      };
    case 'hold':
      return { event: 'hold', properties: { request_id, reason: primaryReason(decision.reasons) } };
    case 'deny':
      return { event: 'deny', properties: { request_id, reason: primaryReason(decision.reasons) } };
  }
}
