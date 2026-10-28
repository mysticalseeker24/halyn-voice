import {
  type ActionId,
  base64urlDecode,
  type Clock,
  CompactJwsSchema,
  type CompiledPolicyPack,
  CompiledPolicyPackSchema,
  type ConfirmChannel,
  describeAction,
  E164Schema,
  GrantClaimsSchema,
  HalynError,
  Hex64Schema,
  type HubRole,
  type Handoff,
  type JsonValue,
  type LedgerEntry,
  type Money,
  movesMoney,
  newId,
  type OutcomeEvent,
  parseActionParams,
  type ReasonCode,
  type Region,
  RegionSchema,
  type Rng,
  RunIdSchema,
  type WsMessage,
} from '@halyn/shared';
import { z } from 'zod';
import {
  decide,
  escalateForCoaching,
  type GateContext,
  type GateDecision,
  type ProposeRequest,
  resolveStepUp,
  type StepUpAnswer,
  toDecision,
} from '../gate';
import type { SignedGrant } from '../grants';
import { mintPassCode, passState, verifyPassCode } from '../pass';
import {
  checkinTime,
  customerByName,
  gateCounters,
  passUses,
  primaryReason,
  proposalEvent,
  unusualHour,
} from './call-context';
import type { HubAppend } from './hub-do';
import type { HubStore } from './store';
import type { CallState, DirectoryCustomer, MirrorItem, RequestRecord, RequestStatus } from './types';

// What the Hub does for the Bolna tools and the Confirm orchestration, inside its serial lane (ADR-014, ADR-016):
// identify the caller, verify and mint Pass codes, decide a proposal with the real Gate and record it, settle a
// confirmation into the final outcome, and book-keep execution. Every function here runs with the lane held, so
// read-then-write is atomic per tenant (velocity counters, first answer wins, one execution per request).

/** A repeat of the same (run_id, params_hash) within this window is an LLM retry, not a new request (invariant 7). */
const HOUR = 60 * 60 * 1000;

/** The Hub's side of the lane: storage, time, ids, ledger, WebSockets and the TiDB mirror. */
export interface HubCore {
  tenant: string;
  store: HubStore;
  clock: Clock;
  rng: Rng;
  env: { PASS_CODE_PEPPER?: unknown };
  append(input: HubAppend): Promise<LedgerEntry>;
  send(message: WsMessage, roles?: readonly HubRole[]): void;
  /**
   * Starts the confirmation timer (pending_confirmations + alarm) and appends confirm_requested. Without a prompt
   * the Aero app is not told yet (a request still screening, ADR-024): the timer alone keeps it failing closed.
   */
  openConfirmation(input: {
    request_id: string;
    channels: ConfirmChannel[];
    timeout_seconds: number;
    prompt?: { action: ActionId; summary: string; amount: Money | null };
  }): Promise<number>;
  /** Drops a pending confirmation nobody was asked yet (a screened request turned into a hold). */
  cancelConfirmation(request_id: string): void;
  mirror(item: MirrorItem): void;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function json(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ── callers ─────────────────────────────────────────────────────────────────────────────────────

export const IdentifyInputSchema = z.strictObject({
  run_id: RunIdSchema,
  call_sid: z.string().min(1).max(124).nullable(),
  channel: z.enum(['phone', 'web']),
  region: RegionSchema,
  number_hash: Hex64Schema.nullable(),
  from_last4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  claimed_name: z.string().min(1).max(80).nullable(),
});
export type IdentifyInput = z.infer<typeof IdentifyInputSchema>;

function mirrorCall(core: HubCore, call: CallState): void {
  core.mirror({
    kind: 'call',
    row: json({
      id: call.id,
      run_id: call.run_id,
      agent: 'aero',
      channel: call.channel,
      from_number_last4: call.from_last4,
      started_at: call.started_at,
      ended_at: call.ended_at,
      purpose: call.purpose,
    }),
  });
}

/**
 * The call's state, created on first sight. The registered number identifies the customer; failing that, a name the
 * caller gave (never proof — the Gate sees `registered: false`, so the clone of scenario 3 gets S_UNREGISTERED_NUMBER).
 */
export function identify(
  core: HubCore,
  input: IdentifyInput,
): { call: CallState; customer: DirectoryCustomer | null } {
  const { store } = core;
  const existing = store.call(input.run_id);
  const byNumber = input.number_hash ? store.customerByNumber(input.region, input.number_hash) : null;
  const byName =
    !byNumber && input.claimed_name
      ? customerByName(store.customers(), input.claimed_name, input.region)
      : null;
  const found = byNumber ?? byName;
  let call: CallState;
  if (existing) {
    // A later lookup may identify the customer, never swap one customer for another or unset a Pass.
    const customer_id = existing.customer_id ?? found?.id ?? null;
    call = {
      ...existing,
      call_sid: existing.call_sid ?? input.call_sid,
      customer_id,
      registered: existing.registered || (byNumber !== null && byNumber.id === customer_id),
      kind: existing.pass_id ? existing.kind : found ? 'human' : existing.kind,
    };
  } else {
    call = {
      id: newId('call', core.clock, core.rng),
      run_id: input.run_id,
      call_sid: input.call_sid,
      channel: input.channel,
      region: input.region,
      customer_id: found?.id ?? null,
      registered: byNumber !== null,
      number_hash: input.number_hash,
      from_last4: input.from_last4,
      kind: found ? 'human' : 'unknown',
      pass_id: null,
      app_session_customer_id: null,
      started_at: core.clock.nowMs(),
      ended_at: null,
      purpose: null,
    };
  }
  store.putCall(call);
  mirrorCall(core, call);
  const customer = call.customer_id ? store.customer(call.customer_id) : null;
  return { call, customer };
}

// ── Pass codes (docs/PASS.md) ──────────────────────────────────────────────────────────────────

function pepper(core: HubCore): string {
  const parsed = z.string().min(16).safeParse(core.env.PASS_CODE_PEPPER);
  if (!parsed.success) throw new HalynError('E_FAIL_CLOSED', 'hub: PASS_CODE_PEPPER is not configured');
  return parsed.data;
}

/** verify_pass: on success the call's proof becomes this Pass. Failures count towards the lock; the 5th locks it. */
export async function verifyPass(
  core: HubCore,
  input: { run_id: string; call_sid: string | null; from_number: string; code: string; region: Region },
): Promise<{ valid: false } | { valid: true; assistant_name: string; scopes: string[] }> {
  const { store, clock } = core;
  const from = E164Schema.parse(input.from_number);
  const passes = store.passesForNumber(from);
  const result = await verifyPassCode(
    {
      tenant_id: core.tenant,
      code: input.code,
      from_number: from,
      candidates: passes.map((pass) => ({ pass, codes: store.codes(pass.id) })),
      pepper: pepper(core),
    },
    clock,
  );
  const now = iso(clock.nowMs());
  for (const update of result.updates.codes) {
    const code = store.code(update.id);
    if (!code) continue;
    const used = { ...code, used_at: update.used_at };
    store.putCode(used);
    core.mirror({ kind: 'pass_code', row: json(used) });
  }
  for (const update of result.updates.passes) {
    const pass = store.pass(update.id);
    if (!pass) continue;
    store.putPass({ ...pass, failures: update.failures, status: update.status });
    core.mirror({
      kind: 'pass',
      row: json({ id: pass.id, failures: update.failures, status: update.status }),
    });
    if (pass.status !== 'locked' && update.status === 'locked')
      await core.append({
        type: 'pass_locked',
        ref_id: pass.id,
        payload: { failures: update.failures, at: now },
      });
  }
  if (!result.valid) {
    console.log(JSON.stringify({ level: 'warn', hub: 'pass_code_refused', reason: result.reason }));
    return { valid: false };
  }
  const pass = store.pass(result.pass_id);
  if (!pass) throw new HalynError('E_FAIL_CLOSED', 'hub: verified Pass vanished');
  const call = store.call(input.run_id);
  const updated: CallState = call
    ? { ...call, pass_id: pass.id, customer_id: pass.customer_id, kind: 'ai_assistant' }
    : {
        id: newId('call', clock, core.rng),
        run_id: input.run_id,
        call_sid: input.call_sid,
        channel: 'phone',
        region: input.region,
        customer_id: pass.customer_id,
        registered: false,
        number_hash: null,
        from_last4: from.slice(-4),
        kind: 'ai_assistant',
        pass_id: pass.id,
        app_session_customer_id: null,
        started_at: clock.nowMs(),
        ended_at: null,
        purpose: null,
      };
  store.putCall(updated);
  mirrorCall(core, updated);
  return { valid: true, assistant_name: pass.assistant_name, scopes: result.scopes.map((s) => s.action) };
}

/** get_pass_code: a fresh one-time code for the assistant to say (only its hash is stored). */
export async function mintCode(
  core: HubCore,
  input: { pass_id: string; calling_number: string },
): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  const pass = core.store.pass(input.pass_id);
  if (!pass || pass.tenant_id !== core.tenant) return { ok: false, reason: 'unknown_pass' };
  const minted = await mintPassCode(
    { pass, calling_number: input.calling_number, pepper: pepper(core) },
    core.clock,
    core.rng,
  );
  if (!minted.ok) return { ok: false, reason: minted.reason };
  core.store.putCode(minted.record);
  core.mirror({ kind: 'pass_code', row: json(minted.record) });
  return { ok: true, code: minted.code };
}

// ── proposals ──────────────────────────────────────────────────────────────────────────────────

export const ProposeInputSchema = z.strictObject({
  run_id: RunIdSchema,
  call_sid: z.string().min(1).max(124).nullable(),
  channel: z.enum(['phone', 'web']),
  /** Validated only (the Gate's caller) and matched against a verified Pass; never stored. */
  from_number: E164Schema.nullable(),
  number_hash: Hex64Schema.nullable(),
  /** The region to assume when the call was never identified (lookup_customer skipped). */
  default_region: RegionSchema,
  action: z.string().min(1).max(64),
  /** The raw params as JSON text: JSON.parse keeps an own "__proto__" key for the strict schema to refuse. */
  params_json: z.string().max(8192),
  params_hash: Hex64Schema,
  readback_confirmed: z.boolean(),
  caller_quotes: z.array(z.string().max(300)).max(5),
  coaching: z.strictObject({ score: z.number().min(0).max(1), cues: z.array(z.string().max(64)).max(32) }),
  distress: z.boolean(),
  /** Compiled packs by region (loaded from KV by the Worker); re-validated here. */
  packs: z.record(z.string(), z.unknown()),
  /** Whether the Confirm callback can ring now, and the hash of the one number it may ring (CUSTOMER_PHONE). */
  callback: z.strictObject({ available: z.boolean(), number_hash: Hex64Schema.nullable() }),
  /** Coaching layer 2 will read the quotes (ADR-024): a money allow/step_up waits for finishScreening. */
  screen: z.boolean().optional(),
});
export type ProposeInput = z.infer<typeof ProposeInputSchema>;

export interface ProposeOutcome {
  duplicate: boolean;
  record: RequestRecord;
  /** The customer's spoken name and language, for the Confirm callback's user_data. */
  customer: { spoken_name: string; language: 'hi' | 'en' } | null;
}

const FAIL_CLOSED_DECISION = (action: GateDecision['action']): GateDecision => ({
  action,
  outcome: 'deny',
  tier: null,
  base_tier: null,
  proof: 'none',
  signals: [],
  reasons: ['E_FAIL_CLOSED'],
  amount: null,
  confirm: null,
});

function statusFor(outcome: GateDecision['outcome']): RequestStatus {
  return { allow: 'approved', step_up: 'awaiting_confirmation', hold: 'held', deny: 'refused' }[
    outcome
  ] as RequestStatus;
}

function packFor(input: ProposeInput, region: Region): CompiledPolicyPack | null {
  const parsed = CompiledPolicyPackSchema.safeParse(input.packs[region]);
  return parsed.success && parsed.data.region === region ? parsed.data : null;
}

function mirrorRequest(core: HubCore, record: RequestRecord): void {
  core.mirror({
    kind: 'request',
    row: json({
      request: {
        id: record.request_id,
        call_id: record.call_id,
        run_id: record.run_id,
        customer_id: record.customer_id,
        action: record.action,
        params: record.params,
        params_hash: record.params_hash,
        readback_confirmed: record.readback_confirmed,
        caller_quotes: record.caller_quotes,
        created_at: record.created_at,
      },
      decision: {
        id: `dec_${record.request_id.slice(4)}`,
        request_id: record.request_id,
        outcome: record.decision.outcome,
        final_outcome: record.final_outcome,
        tier: record.decision.tier,
        base_tier: record.decision.base_tier,
        reasons: record.decision.reasons,
        signals: record.gate.signals,
        coaching: record.coaching,
        decided_at: record.created_at,
      },
    }),
  });
}

function broadcastDecision(core: HubCore, record: RequestRecord): void {
  if (record.gate.action === null) return;
  core.send({
    type: 'decision',
    at: iso(core.clock.nowMs()),
    action: record.gate.action,
    decision: record.decision,
  });
}

/** Create the handoff a hold needs (GATE.md clarification 3: every hold goes to a specialist). */
export async function openHandoff(
  core: HubCore,
  record: RequestRecord,
  reasons: ReasonCode[],
): Promise<string> {
  const id = newId('ho', core.clock, core.rng);
  const reason = primaryReason(reasons);
  const now = core.clock.nowMs();
  // Scenario 4: a coached (or distressed) customer gets a check-in call booked — a record only; nothing rings.
  const why = reasons.includes('T_DISTRESS')
    ? ('distress' as const)
    : reasons.includes('S_COACHING')
      ? ('coaching' as const)
      : null;
  const checkin = why
    ? { at: iso(checkinTime(now, record.region)), why, status: 'scheduled' as const }
    : null;
  await core.append({
    type: 'handoff',
    ref_id: record.request_id,
    payload: {
      handoff_id: id,
      reasons,
      reason,
      call_id: record.call_id,
      status: 'open',
      ...(checkin ? { checkin: { at: checkin.at, why: checkin.why } } : {}),
    },
  });
  core.store.putHandoff({
    id,
    request_id: record.request_id,
    call_id: record.call_id,
    run_id: record.run_id,
    customer_id: record.customer_id,
    action: record.action,
    summary: record.summary,
    reasons: reasons.length > 0 ? reasons : ['H_SPECIALIST'],
    reason,
    status: 'open',
    note: null,
    checkin,
    created_at: iso(now),
    resolved_at: null,
  });
  core.send({
    type: 'handoff',
    at: iso(core.clock.nowMs()),
    handoff_id: id,
    request_id: record.request_id,
    reasons: reasons.length > 0 ? reasons : ['H_SPECIALIST'],
    status: 'open',
  });
  core.mirror({
    kind: 'handoff',
    row: json({
      id,
      request_id: record.request_id,
      call_id: record.call_id,
      reason,
      status: 'open',
      created_at: core.clock.nowMs(),
    }),
  });
  return id;
}

/** Decide one proposal and record it. A repeat of the same (run_id, params_hash) always returns the first record (invariant 7). */
export async function propose(core: HubCore, raw: ProposeInput): Promise<ProposeOutcome> {
  const input = ProposeInputSchema.parse(raw);
  const { store, clock } = core;
  const now = clock.nowMs();
  const idem_key = `${input.run_id}:${input.params_hash}`;
  const latest = store.requestsByKey(idem_key)[0];
  const customerOf = (id: string | null) => {
    const c = id ? store.customer(id) : null;
    return c ? { spoken_name: c.spoken_name, language: c.language } : null;
  };
  // Invariant 7: the same (run_id, params_hash) is the same request for the whole call, whatever its age or state.
  if (latest) return { duplicate: true, record: latest, customer: customerOf(latest.customer_id) };

  // The call: from lookup_customer / verify_pass, or identified now by the calling number alone.
  const { call } = store.call(input.run_id)
    ? { call: store.call(input.run_id) as CallState }
    : identify(core, {
        run_id: input.run_id,
        call_sid: input.call_sid,
        channel: input.channel,
        region: input.default_region,
        number_hash: input.number_hash,
        from_last4: input.from_number?.slice(-4) ?? null,
        claimed_name: null,
      });
  const pack = packFor(input, call.region);
  const pass = call.pass_id ? store.pass(call.pass_id) : null;
  const passActive = pass !== null && passState(pass, now) === 'active';
  const history = call.customer_id ? store.customerRequests(call.customer_id, now - 400 * 24 * HOUR) : [];

  let params: unknown;
  try {
    params = JSON.parse(input.params_json);
  } catch {
    params = null;
  }
  const request_id = newId('req', clock, core.rng);
  let gate: GateDecision;
  if (!pack || params === null || typeof params !== 'object' || Array.isArray(params)) {
    gate = FAIL_CLOSED_DECISION(null);
  } else {
    const proof: GateContext['proof'] = passActive
      ? 'pass'
      : call.registered
        ? 'registered_number'
        : call.channel === 'web' &&
            call.app_session_customer_id !== null &&
            call.app_session_customer_id === call.customer_id
          ? 'app_session'
          : 'none';
    const fromPassNumber =
      passActive && input.from_number !== null && pass.assistant_numbers.includes(input.from_number);
    const request: ProposeRequest = {
      tenant_id: core.tenant,
      run_id: input.run_id,
      channel: call.channel,
      caller: {
        ...(input.from_number ? { from_number: input.from_number } : {}),
        ...(call.app_session_customer_id ? { app_session_customer_id: call.app_session_customer_id } : {}),
        kind: call.kind,
      },
      customer_id: call.customer_id,
      action: input.action as ProposeRequest['action'],
      params: params as Record<string, unknown>,
      readback_confirmed: input.readback_confirmed,
      caller_quotes: input.caller_quotes,
    };
    const context: GateContext = {
      proof,
      ...(passActive ? { pass: { scopes: pass.scopes, uses: passUses(history, pass.id) } } : {}),
      counters: gateCounters(history, call.customer_id, pack, now),
      signals: {
        unregistered_number: !call.registered && !fromPassNumber && !passActive,
        calls_last_hour: call.number_hash ? store.callsFromNumberSince(call.number_hash, now - HOUR) : 0,
        unusual_hour: unusualHour(now, call.region),
      },
      coaching: input.coaching,
      distress: input.distress,
    };
    gate = decide(request, context, pack, clock);
  }

  const proposed =
    typeof params === 'object' && params !== null ? parseActionParams(input.action, params) : null;
  const customer = call.customer_id ? store.customer(call.customer_id) : null;
  let channels: ConfirmChannel[] = [];
  if (gate.outcome === 'step_up') {
    const callbackOk =
      input.callback.available && customer !== null && customer.number_hash === input.callback.number_hash;
    channels = (gate.confirm?.channels ?? ['passkey']).filter((c) => c === 'passkey' || callbackOk);
    if (channels.length === 0) channels = ['passkey'];
  }
  const timeout = gate.confirm?.timeout_seconds ?? 60;
  const screening =
    input.screen === true &&
    gate.action !== null &&
    movesMoney(gate.action) &&
    (gate.outcome === 'allow' || gate.outcome === 'step_up');
  let record: RequestRecord = {
    request_id,
    run_id: input.run_id,
    idem_key,
    call_id: call.id,
    customer_id: call.customer_id,
    region: call.region,
    channel: call.channel,
    action: input.action,
    params: proposed?.ok ? (proposed.value.params as Record<string, JsonValue>) : {},
    params_hash: input.params_hash,
    readback_confirmed: input.readback_confirmed,
    caller_quotes: input.caller_quotes,
    coaching: input.coaching,
    summary: proposed?.ok ? describeAction(proposed.value) : 'A request Aero could not read',
    created_at: now,
    gate,
    decision: toDecision(gate, request_id),
    pack_sha: pack?.source_sha ?? null,
    pass_id: passActive ? pass.id : null,
    status: statusFor(gate.outcome),
    final_outcome: null,
    execute_at: null,
    confirm:
      gate.outcome === 'step_up' ? { channels, deadline: now + timeout * 1000, execution_id: null } : null,
    execution: null,
    failure: null,
    handoff_id: null,
    ...(screening ? { screening: true } : {}),
    last_event: null,
  };
  record.last_event = proposalEvent(record);
  if (pack) store.putPack(pack);
  store.putRequest(record);

  await core.append({
    type: 'proposed',
    ref_id: request_id,
    payload: {
      run_id: input.run_id,
      call_id: call.id,
      customer_id: call.customer_id,
      channel: call.channel,
      action: input.action,
      params: record.params,
      params_hash: input.params_hash,
      readback_confirmed: input.readback_confirmed,
    },
  });
  await core.append({
    type: 'decided',
    ref_id: request_id,
    payload: json({
      outcome: gate.outcome,
      tier: gate.tier,
      base_tier: gate.base_tier,
      proof: gate.proof,
      reasons: record.decision.reasons,
      signals: gate.signals,
      coaching_cues: input.coaching.cues,
    }),
  });
  if (gate.outcome === 'step_up' && proposed?.ok) {
    const deadline = await core.openConfirmation({
      request_id,
      channels,
      timeout_seconds: timeout,
      ...(screening
        ? {}
        : { prompt: { action: proposed.value.action, summary: record.summary, amount: gate.amount } }),
    });
    record = { ...record, confirm: { channels, deadline, execution_id: null } };
  }
  if (gate.outcome === 'hold')
    record = { ...record, handoff_id: await openHandoff(core, record, gate.reasons) };
  store.putRequest(record);
  // Allowed: watched until a Worker claims it; if none does in time, the sweep fails it closed (reconcile.ts).
  if (record.status === 'approved') store.markApproved(request_id, now);
  broadcastDecision(core, record);
  mirrorRequest(core, record);
  return {
    duplicate: false,
    record,
    customer: customer ? { spoken_name: customer.spoken_name, language: customer.language } : null,
  };
}

// ── coaching layer 2 (ADR-024) ─────────────────────────────────────────────────────────────────

/**
 * Coaching layer 2's answer for a request still screening. max(layer 1, layer 2) ≥ threshold on a money allow or
 * step_up → the step-3 hold (handoff, check-in, the `hold` event); otherwise the request goes on as decided and a
 * step-up's approval sheet reaches the Aero app now. `layer2` null (Sarvam down or slow) → layer 1 alone. Null when
 * the request is no longer screening (the sweep or the confirmation timer settled it first): send nothing.
 */
export async function finishScreening(
  core: HubCore,
  request_id: string,
  layer2: { score: number; cues: string[] } | null,
): Promise<RequestRecord | null> {
  const { store, clock } = core;
  const record = store.request(request_id);
  if (!record?.screening) return null;
  if (record.status !== 'approved' && record.status !== 'awaiting_confirmation') return null;
  const coaching = layer2
    ? {
        score: Math.max(record.coaching.score, layer2.score),
        cues: [...new Set([...record.coaching.cues, ...layer2.cues])].slice(0, 32),
      }
    : record.coaching;
  const pack = record.pack_sha ? store.pack(record.pack_sha) : null;
  const held = pack ? escalateForCoaching(record.gate as GateDecision, coaching.score, pack) : null;
  const { screening: _done, ...rest } = record;
  if (!held) {
    const cleared: RequestRecord = { ...rest, coaching };
    store.putRequest(cleared);
    if (cleared.status === 'awaiting_confirmation' && cleared.confirm && record.gate.action)
      core.send(
        {
          type: 'confirm_request',
          at: iso(clock.nowMs()),
          request_id,
          action: record.gate.action,
          summary: record.summary,
          amount: record.gate.amount,
          channels: cleared.confirm.channels,
          expires_at: iso(cleared.confirm.deadline),
        },
        ['aero', 'stage'],
      );
    return cleared;
  }
  if (record.status === 'approved') store.clearApproved(request_id);
  else core.cancelConfirmation(request_id);
  let updated: RequestRecord = {
    ...rest,
    coaching,
    gate: held,
    decision: toDecision(held, request_id),
    status: 'held',
    confirm: null,
  };
  updated = { ...updated, last_event: proposalEvent(updated) };
  store.putRequest(updated);
  await core.append({
    type: 'decided',
    ref_id: request_id,
    payload: json({
      outcome: 'hold',
      tier: held.tier,
      base_tier: held.base_tier,
      proof: held.proof,
      reasons: updated.decision.reasons,
      signals: held.signals,
      coaching_cues: coaching.cues,
      layer: 'llm',
    }),
  });
  updated = { ...updated, handoff_id: await openHandoff(core, updated, held.reasons) };
  store.putRequest(updated);
  broadcastDecision(core, updated);
  core.mirror({
    kind: 'decision',
    row: json({
      request_id,
      final_outcome: 'hold',
      reasons: updated.decision.reasons,
      decided_at: clock.nowMs(),
    }),
  });
  return updated;
}

// ── handoffs: the Console's release / block (docs/API.md "Web") ──────────────────────────────────

/**
 * Release or block an open handoff; the first resolution wins (E_BAD_REQUEST after). Releasing a request that is still
 * held approves it for execution — the specialist decided, and the Worker still signs a grant for the exact action;
 * blocking refuses it. Any other request (a reconcile handoff after execution) only closes the handoff.
 */
export async function resolveHandoff(
  core: HubCore,
  id: string,
  action: 'release' | 'block',
  note: string | null,
): Promise<{ handoff: Handoff; request: RequestRecord | null }> {
  const { store, clock } = core;
  const handoff = store.handoff(id);
  if (!handoff) throw new HalynError('E_NOT_FOUND', 'No such handoff');
  if (handoff.status !== 'open') throw new HalynError('E_BAD_REQUEST', 'This handoff is already resolved');
  const now = clock.nowMs();
  const status = action === 'release' ? ('released' as const) : ('blocked' as const);
  const resolved: Handoff = { ...handoff, status, note, resolved_at: iso(now) };
  store.putHandoff(resolved);
  await core.append({
    type: 'handoff',
    ref_id: handoff.request_id,
    payload: { handoff_id: id, status, reason: handoff.reason },
  });
  core.send({
    type: 'handoff',
    at: iso(now),
    handoff_id: id,
    request_id: handoff.request_id,
    reasons: handoff.reasons,
    status,
  });
  core.mirror({
    kind: 'handoff',
    row: json({
      id,
      request_id: handoff.request_id,
      call_id: handoff.call_id,
      reason: handoff.reason,
      status,
      note,
      created_at: Date.parse(handoff.created_at),
      resolved_at: now,
    }),
  });
  const record = store.request(handoff.request_id);
  if (record?.status !== 'held') return { handoff: resolved, request: record };
  // The Gate's decision stays as recorded (only a step_up's Decision carries a final outcome); the specialist's
  // verdict is the request's final outcome, which limits and the apps read.
  const final_outcome = action === 'release' ? ('allow' as const) : ('deny' as const);
  const { decision } = record;
  const updated: RequestRecord = {
    ...record,
    final_outcome,
    execute_at: null,
    status: action === 'release' ? 'approved' : 'refused',
    last_event:
      action === 'release'
        ? { event: 'approved', properties: { request_id: record.request_id } }
        : {
            event: 'denied',
            properties: { request_id: record.request_id, reason: primaryReason(decision.reasons) },
          },
  };
  store.putRequest(updated);
  await core.append({
    type: 'decided',
    ref_id: record.request_id,
    payload: json({ outcome: decision.outcome, final_outcome, reasons: decision.reasons, handoff: status }),
  });
  if (updated.status === 'approved') store.markApproved(record.request_id, now);
  broadcastDecision(core, updated);
  core.mirror({
    kind: 'decision',
    row: json({ request_id: record.request_id, final_outcome, reasons: decision.reasons, decided_at: now }),
  });
  return { handoff: resolved, request: updated };
}

// ── confirmations → final outcome (GATE.md "After step_up") ─────────────────────────────────────

const ANSWER_EVENT: Record<'declined' | 'timeout', 'denied' | 'timeout'> = {
  declined: 'denied',
  timeout: 'timeout',
};

/**
 * Turn the first answer into the final outcome: resolveStepUp with the pack the Gate decided with; approved → the
 * request is approved for execution (or held for a specialist), declined/timeout → refused. Returns the updated
 * record, or null when there is no request behind this confirmation (or it was already settled).
 */
export async function settleRequest(
  core: HubCore,
  request_id: string,
  answer: StepUpAnswer,
): Promise<RequestRecord | null> {
  const { store, clock } = core;
  const record = store.request(request_id);
  if (!record || record.status !== 'awaiting_confirmation') return null;
  const pack = record.pack_sha ? store.pack(record.pack_sha) : null;
  const resolution = pack
    ? resolveStepUp(record.gate as GateDecision, answer, pack, clock)
    : { final_outcome: 'deny' as const, reasons: ['E_FAIL_CLOSED' as const], execute_at: null };
  const decision = toDecision(record.gate as GateDecision, request_id, resolution);
  let status: RequestStatus = 'refused';
  let event: OutcomeEvent;
  if (resolution.final_outcome === 'allow') {
    status = 'approved';
    event = { event: 'approved', properties: { request_id } };
  } else if (resolution.final_outcome === 'hold') {
    status = 'held';
    event = { event: 'hold', properties: { request_id, reason: primaryReason(decision.reasons) } };
  } else {
    const name = answer === 'approved' ? 'denied' : ANSWER_EVENT[answer];
    event = { event: name, properties: { request_id, reason: primaryReason(decision.reasons) } };
  }
  let updated: RequestRecord = {
    ...record,
    decision,
    final_outcome: resolution.final_outcome,
    execute_at: resolution.execute_at,
    status,
    last_event: event,
  };
  store.putRequest(updated);
  await core.append({
    type: 'decided',
    ref_id: request_id,
    payload: json({
      outcome: decision.outcome,
      final_outcome: resolution.final_outcome,
      answer,
      reasons: decision.reasons,
      execute_at: resolution.execute_at,
    }),
  });
  if (status === 'held')
    updated = { ...updated, handoff_id: await openHandoff(core, updated, decision.reasons) };
  store.putRequest(updated);
  if (status === 'approved') store.markApproved(request_id, clock.nowMs());
  broadcastDecision(core, updated);
  core.mirror({
    kind: 'decision',
    row: json({
      request_id,
      final_outcome: resolution.final_outcome,
      reasons: decision.reasons,
      decided_at: clock.nowMs(),
    }),
  });
  return updated;
}

// ── execution book-keeping (the Worker signs and calls Aero Core outside the lane) ─────────────────

/**
 * Claim an approved request for execution, exactly once. From now on the Hub's sweep watches it as an execution
 * (reconcile.ts). Null when it is not `approved` — already claimed, or failed closed by the sweep because no Worker
 * claimed it in time — so a late Worker signs nothing and sends nothing.
 */
export function beginExecution(core: HubCore, request_id: string): RequestRecord | null {
  const record = core.store.request(request_id);
  if (!record || record.status !== 'approved' || record.screening) return null;
  const claimed: RequestRecord = { ...record, status: 'executing' };
  core.store.putRequest(claimed);
  core.store.clearApproved(request_id);
  core.store.startExecution(request_id, core.clock.nowMs());
  return claimed;
}

/** The exact grant the Worker is about to present, as the compact JWS (ADR-020). */
export const GrantNoteSchema = z.strictObject({ token: CompactJwsSchema });

/** A grant Halyn signed, read back from its compact JWS (Aero Core checks the signature; the Hub only reads it). */
export function grantFromToken(token: string): SignedGrant {
  const segment = token.split('.')[1];
  const bytes = segment === undefined ? null : base64urlDecode(segment);
  let payload: unknown;
  try {
    payload = bytes
      ? JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
      : undefined;
  } catch {
    payload = undefined;
  }
  const claims = GrantClaimsSchema.safeParse(payload);
  if (!claims.success) throw new HalynError('E_FAIL_CLOSED', 'hub: unreadable grant');
  return { token, claims: claims.data };
}

/**
 * Keep the grant in the Hub's own SQLite (never mirrored, logged or returned; dropped when the request is final) so
 * the sweep can present the same grant again, and record it on the ledger. One grant per request, ever (invariant 1).
 */
export async function noteGrant(
  core: HubCore,
  request_id: string,
  raw: z.infer<typeof GrantNoteSchema>,
): Promise<void> {
  const { token } = GrantNoteSchema.parse(raw);
  const { store } = core;
  const record = store.request(request_id);
  const execution = store.execution(request_id);
  if (!record || record.status !== 'executing' || !execution)
    throw new HalynError('E_FAIL_CLOSED', 'hub: no execution in progress for this grant');
  if (execution.token !== null)
    throw new HalynError('E_FAIL_CLOSED', 'hub: this request already has a grant');
  const { claims } = grantFromToken(token);
  if (
    claims.tenant !== core.tenant ||
    claims.request_id !== request_id ||
    claims.sub !== record.customer_id ||
    claims.action !== record.action
  )
    throw new HalynError('E_FAIL_CLOSED', 'hub: the grant is not for this request');
  store.setExecutionToken(request_id, token);
  await core.append({
    type: 'grant_issued',
    ref_id: request_id,
    payload: { jti: claims.jti, params_hash: claims.params_hash, expires_at: iso(claims.exp * 1000) },
  });
  core.mirror({
    kind: 'grant',
    row: json({
      jti: claims.jti,
      request_id,
      params_hash: claims.params_hash,
      issued_at: claims.iat * 1000,
      expires_at: claims.exp * 1000,
      used_at: null,
    }),
  });
}

export const ExecutionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('executed'),
    jti: z.string().min(26).max(26),
    reference: z.string().min(1).max(64),
    summary: z.string().min(1).max(300),
    fresh: z.boolean(),
  }),
  z.strictObject({
    status: z.literal('failed'),
    code: z.string().min(1).max(64),
    http: z.int().nullable(),
    outcome: z.enum(['refused', 'unknown']),
  }),
  z.strictObject({ status: z.literal('handoff'), reason: z.string().min(1).max(64) }),
]);
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

/**
 * Who closes an execution: the Worker that ran it, or the Hub's sweep and what it found (reconcile.ts). `not_claimed`:
 * the request was approved but no Worker ever claimed it (nothing signed, nothing sent to Aero Core).
 */
export type ExecutionSource =
  { by: 'worker' } | { by: 'sweep'; detail: 'no_grant' | 'grant_expired' | 'represented' | 'not_claimed' };

/** Aero Core may or may not have executed: a human checks it (by the grant's reference). */
const RECONCILE_REASONS: ReasonCode[] = ['E_FAIL_CLOSED', 'H_SPECIALIST'];

/**
 * Record what Aero Core answered (or that a specialist must do it) and set the call's next event. The first finish
 * wins: once the request is final a later finish (a late Worker after the sweep, or the reverse) changes nothing and
 * returns null, so its caller sends no second event. One exception keeps the ledger true: an execution reported after
 * a final `failed` is still appended (marked for reconciliation) with a handoff. An unknown outcome is final `failed`
 * E_FAIL_CLOSED, marked for reconciliation, with a specialist handoff — never "not executed".
 */
export async function finishExecution(
  core: HubCore,
  request_id: string,
  raw: ExecutionResult,
  source: ExecutionSource = { by: 'worker' },
): Promise<RequestRecord | null> {
  const result = ExecutionResultSchema.parse(raw);
  const { store, clock } = core;
  const record = store.request(request_id);
  const isFinal = record?.status === 'executed' || record?.status === 'failed' || record?.status === 'held';
  // Only the sweep may close an approval no Worker claimed, and only as "nothing was sent" (reconcile.ts).
  const unclaimed =
    record?.status === 'approved' &&
    source.by === 'sweep' &&
    source.detail === 'not_claimed' &&
    result.status === 'failed' &&
    result.outcome === 'refused';
  if (!record || (record.status !== 'executing' && !isFinal && !unclaimed))
    throw new HalynError('E_FAIL_CLOSED', 'hub: no execution in progress for this request');
  const swept: Record<string, JsonValue> =
    source.by === 'sweep' ? { by: 'sweep', detail: source.detail } : {};
  if (isFinal) {
    if (result.status === 'executed' && record.status === 'failed') {
      await core.append({
        type: 'executed',
        ref_id: request_id,
        payload: {
          reference: result.reference,
          jti: result.jti,
          earlier_attempt: !result.fresh,
          reconcile: 'needed',
          after: record.status,
          ...swept,
        },
      });
      if (record.handoff_id === null)
        store.putRequest({ ...record, handoff_id: await openHandoff(core, record, RECONCILE_REASONS) });
    }
    return null;
  }
  const token = store.execution(request_id)?.token ?? null;
  let jti: string | null;
  try {
    jti = token === null ? null : grantFromToken(token).claims.jti;
  } catch {
    jti = null;
  }
  store.endExecution(request_id);
  store.clearApproved(request_id);
  const now = clock.nowMs();
  let updated: RequestRecord;
  if (result.status === 'executed') {
    updated = {
      ...record,
      status: 'executed',
      execution: { jti: result.jti, reference: result.reference, at: now, summary: result.summary },
      last_event: { event: 'done', properties: { reference: result.reference, summary: result.summary } },
    };
    store.putRequest(updated);
    await core.append({
      type: 'executed',
      ref_id: request_id,
      payload: { reference: result.reference, jti: result.jti, earlier_attempt: !result.fresh, ...swept },
    });
    core.mirror({ kind: 'grant', row: json({ jti: result.jti, request_id, used_at: now }) });
  } else if (result.status === 'handoff') {
    // No Aero Core route, or a tier-4 approval that may only run after its hold: a specialist completes it.
    const reason = result.reason === 'P_TIER4_HOLD_24H' ? 'P_TIER4_HOLD_24H' : 'H_SPECIALIST';
    updated = { ...record, status: 'held' };
    updated = {
      ...updated,
      handoff_id: await openHandoff(core, updated, [...new Set<ReasonCode>([reason, 'H_SPECIALIST'])]),
      last_event: { event: 'hold', properties: { request_id, reason } },
    };
    store.putRequest(updated);
  } else {
    const unknown = result.outcome === 'unknown';
    const code: ReasonCode = unknown
      ? 'E_FAIL_CLOSED'
      : result.code === 'E_BAD_REQUEST' || result.code === 'E_NOT_FOUND'
        ? 'E_CORE_REJECTED'
        : (result.code as ReasonCode);
    updated = {
      ...record,
      status: 'failed',
      failure: code,
      last_event: { event: 'deny', properties: { request_id, reason: code } },
    };
    store.putRequest(updated);
    await core.append({
      type: 'core_rejected',
      ref_id: request_id,
      payload: {
        code,
        aero_code: source.by === 'sweep' && source.detail !== 'represented' ? null : result.code,
        http: result.http,
        outcome: result.outcome,
        ...(unknown ? { reconcile: 'needed', jti } : {}),
        ...swept,
      },
    });
    if (unknown) {
      updated = { ...updated, handoff_id: await openHandoff(core, updated, RECONCILE_REASONS) };
      store.putRequest(updated);
    }
  }
  return updated;
}

/** Attach the Confirm callback's Bolna execution to a request (to stop it, and to check confirm_result's run id). */
export function attachCallback(core: HubCore, request_id: string, execution_id: string | null): void {
  const record = core.store.request(request_id);
  if (!record?.confirm) return;
  const channels: ConfirmChannel[] =
    execution_id === null ? record.confirm.channels.filter((c) => c !== 'callback') : record.confirm.channels;
  core.store.putRequest({
    ...record,
    confirm: {
      ...record.confirm,
      channels: channels.length > 0 ? channels : ['passkey'],
      execution_id,
    },
  });
  core.mirror({
    kind: 'confirmation',
    row: json({
      id: `cnf_${request_id.slice(4)}_cb`,
      request_id,
      channel: 'callback',
      status: execution_id === null ? 'failed' : 'pending',
      answer: null,
      bolna_execution_id: execution_id,
      answered_at: null,
    }),
  });
}
