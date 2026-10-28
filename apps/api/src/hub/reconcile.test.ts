import { type ActionId, type CoreActionId, importSigningKey, paramsHash } from '@halyn/shared';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, REGISTERED, tick, UNREGISTERED } from '../../test/fixtures/app';
import { IN_PACK, US_PACK } from '../../test/fixtures/gate';
import { buildCoreRequest, type CoreTransport } from '../core-client/client';
import { registeredNumberHash } from '../db/numbers';
import { flowContext } from '../flow/context';
import { executeRequest } from '../flow/execute';
import { type SignedGrant, signGrant } from '../grants';
import { grantFromToken } from './flows';
import type { HubDO } from './hub-do';
import { PRESENT_MARGIN_MS, SWEEP_BATCH, SWEEP_DELAY_MS } from './reconcile';

// A Worker that dies between beginExecution and finishExecution (invariant 2): the Hub's alarm sweeps the request
// once it has been `executing` for SWEEP_DELAY_MS and resolves it with the SAME grant, or fails closed (ADR-020).
// Real Hub, real grants, real Aero Core (in-process D1); the test plays the dying Worker step by step.

const RUN = '2c4e6a8b-1111-4222-8333-944455556666';
const STEP_RUN = '2c4e6a8b-2222-4333-8444-955566667777';
const bindings = env as unknown as { PHONE_HASH_PEPPER: string; HALYN_SIGNING_KEY: string };
const START = 52_000_000;
const transfer = { amount_minor: 100_000, currency: 'INR', payee_id: 'payee_mom' };
const freeze = { card_last4: '8812' };

let h: AppHarness;
let logs: string[];

beforeEach(async () => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logs.push(String(line)));
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

/** An approved request straight from the Hub: no Worker picks it up, so the test plays the Worker. */
async function approved(action: string, params: Record<string, unknown>, run_id = RUN): Promise<string> {
  const outcome = await h.hub.propose({
    run_id,
    call_sid: null,
    channel: 'phone',
    from_number: REGISTERED,
    number_hash: await registeredNumberHash(bindings.PHONE_HASH_PEPPER, REGISTERED),
    default_region: 'IN',
    action,
    params_json: JSON.stringify(params),
    params_hash: await paramsHash(params),
    readback_confirmed: true,
    caller_quotes: [],
    coaching: { score: 0, cues: [] },
    distress: false,
    packs: { IN: IN_PACK, US: US_PACK },
    callback: { available: false, number_hash: null },
  });
  expect(outcome.record.status).toBe('approved');
  return outcome.record.request_id;
}

async function sign(request_id: string): Promise<SignedGrant> {
  const record = await h.hub.requestState(request_id);
  if (!record?.customer_id) throw new Error('no such request');
  return signGrant(
    {
      tenant: h.tenant,
      sub: record.customer_id,
      action: record.action as ActionId,
      params: record.params,
      request_id,
    },
    await importSigningKey(bindings.HALYN_SIGNING_KEY),
    h.clock,
    h.rng,
  );
}

/** executeRequest's steps, up to the point where the Worker died. */
async function workerDies(
  request_id: string,
  at: 'after_begin' | 'after_grant' | 'after_core',
): Promise<SignedGrant | null> {
  const claimed = await h.hub.beginExecution(request_id);
  if (!claimed) throw new Error('not claimed');
  if (at === 'after_begin') return null;
  const grant = await sign(request_id);
  await h.hub.noteGrant(request_id, { token: grant.token });
  if (at === 'after_core')
    // Aero Core commits; the answer never reaches the Worker.
    await h.aero.transport(buildCoreRequest(claimed.action as CoreActionId, claimed.params, grant.token));
  return grant;
}

/** Aero Core as the Hub reaches it, recording every grant presented. */
async function hubCore(
  respond: (request: Request) => Promise<Response> = (request) => h.aero.transport(request),
): Promise<string[]> {
  const tokens: string[] = [];
  await runInDurableObject(h.raw, (hub: HubDO) => {
    hub.coreTransport = async (request) => {
      tokens.push(request.headers.get('x-halyn-grant') ?? '');
      return respond(request);
    };
  });
  return tokens;
}

/**
 * Aero Core as the Hub reaches it, holding each request until `open()`. The gate lives in the Hub's own context:
 * workerd refuses a promise resolved from another Durable Object (the test runner is one).
 */
async function heldHubCore(): Promise<{ tokens: string[]; open(): Promise<void> }> {
  const tokens: string[] = [];
  await runInDurableObject(h.raw, (hub: HubDO) => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    Object.assign(hub, { openGate: open });
    hub.coreTransport = async (request) => {
      tokens.push(request.headers.get('x-halyn-grant') ?? '');
      await gate;
      return h.aero.transport(request);
    };
  });
  return {
    tokens,
    open: () =>
      runInDurableObject(h.raw, (hub: HubDO) => (hub as unknown as { openGate(): void }).openGate()),
  };
}

async function sweep(afterMs = SWEEP_DELAY_MS + 1_000): Promise<void> {
  h.clock.advance(afterMs);
  await runDurableObjectAlarm(h.raw);
}

const entries = async (id: string) => (await h.ledger()).filter((e) => e.ref_id === id);
const types = async (id: string) => (await entries(id)).map((e) => e.type);
const events = () => h.bolna.events.get(RUN) ?? [];
const hubRows = (sql: string) =>
  runInDurableObject(h.raw, (_: HubDO, state: DurableObjectState) => state.storage.sql.exec(sql).toArray());
async function balance(): Promise<number | undefined> {
  const rows = await h.aero.rows<{ balance_minor: number }>(
    "SELECT balance_minor FROM accounts WHERE tenant_id = ? AND customer_ref = 'cus_saksham' AND type = 'savings'",
    h.tenant,
  );
  return rows[0]?.balance_minor;
}
const uses = async (jti: string) =>
  (await h.aero.rows<{ n: number }>('SELECT COUNT(*) AS n FROM used_grants WHERE jti = ?', jti))[0]?.n;

describe('the signed grant lives only in the Hub, and only while the request executes', () => {
  it('noteGrant keeps the compact grant in Hub SQLite; never in the ledger, the TiDB mirror, a route, a socket or a log', async () => {
    const sockets = await h.listen('console');
    const id = await approved('card.freeze', freeze);
    const grant = (await workerDies(id, 'after_grant')) as SignedGrant;
    expect(await hubRows('SELECT request_id, token FROM executions')).toEqual([
      { request_id: id, token: grant.token },
    ]);
    await hubCore();
    await sweep();
    await tick();
    expect(await hubRows('SELECT request_id FROM executions')).toEqual([]);
    const signature = grant.token.split('.')[2] as string;
    const outside = JSON.stringify([
      await h.ledger(),
      h.ledgerSink.batches,
      h.mirror.items,
      await h.hub.requestState(id),
      await h.hub.customerView('cus_saksham'),
      sockets,
      logs,
    ]);
    expect(outside).not.toContain(signature);
    // The ledger and the mirror still name the grant by its jti.
    expect(outside).toContain(grant.claims.jti);
  });

  it('never two grants for one request: a second grant, or one for another request, is refused', async () => {
    const id = await approved('card.freeze', freeze);
    await workerDies(id, 'after_grant');
    await expect(h.hub.noteGrant(id, { token: (await sign(id)).token })).rejects.toMatchObject({
      code: 'E_FAIL_CLOSED',
    });
    const other = await approved('card.freeze', { card_last4: '4411' });
    await h.hub.beginExecution(other);
    await expect(h.hub.noteGrant(other, { token: (await sign(id)).token })).rejects.toMatchObject({
      code: 'E_FAIL_CLOSED',
    });
    // Not executing (never claimed): no grant can be noted at all.
    const idle = await approved('card.freeze', { card_last4: '9900' });
    await expect(h.hub.noteGrant(idle, { token: (await sign(idle)).token })).rejects.toMatchObject({
      code: 'E_FAIL_CLOSED',
    });
    expect((await types(id)).filter((t) => t === 'grant_issued')).toHaveLength(1);
    expect(await types(other)).not.toContain('grant_issued');
  });

  it('beginExecution arms the alarm for the sweep', async () => {
    const id = await approved('card.freeze', freeze);
    await h.fireAlarm(); // flush the outboxes: nothing else is pending
    const t0 = h.clock.nowMs();
    await workerDies(id, 'after_begin');
    const alarm = await runInDurableObject(h.raw, (_: HubDO, state: DurableObjectState) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBe(t0 + SWEEP_DELAY_MS);
  });
});

describe('the sweep resolves a request whose Worker died', () => {
  it('no grant noted → nothing reached Aero Core → failed, deny E_FAIL_CLOSED (not before the delay)', async () => {
    const id = await approved('card.freeze', freeze);
    await workerDies(id, 'after_begin');
    await sweep(SWEEP_DELAY_MS - 1_000);
    expect((await h.hub.requestState(id))?.status).toBe('executing');
    await sweep(2_000);
    expect(await h.hub.requestState(id)).toMatchObject({
      status: 'failed',
      failure: 'E_FAIL_CLOSED',
      handoff_id: null,
    });
    expect(events()).toEqual([{ event: 'deny', properties: { request_id: id, reason: 'E_FAIL_CLOSED' } }]);
    expect(h.aero.calls).toEqual([]);
    expect(await types(id)).toEqual(['proposed', 'decided', 'core_rejected']);
    expect((await entries(id)).at(-1)?.payload).toMatchObject({
      code: 'E_FAIL_CLOSED',
      outcome: 'refused',
      by: 'sweep',
      detail: 'no_grant',
    });
    await sweep();
    expect(events()).toHaveLength(1);
  });

  it('grant noted, Worker died before Aero Core → the SAME grant is presented → executed, done, core_update', async () => {
    const sockets = await h.listen('aero');
    const tokens = await hubCore();
    const id = await approved('transfer.saved', transfer);
    const grant = (await workerDies(id, 'after_grant')) as SignedGrant;
    await sweep();
    await tick();
    expect(tokens).toEqual([grant.token]);
    const reference = `AERO-${grant.claims.jti.slice(-6)}`;
    expect(await h.hub.requestState(id)).toMatchObject({
      status: 'executed',
      execution: { jti: grant.claims.jti, reference },
    });
    expect(events()).toEqual([
      { event: 'done', properties: { reference, summary: expect.stringContaining('Sent') } },
    ]);
    expect(await balance()).toBe(START - 100_000);
    expect(await types(id)).toEqual(['proposed', 'decided', 'grant_issued', 'executed']);
    expect(sockets).toContainEqual(
      expect.objectContaining({
        type: 'core_update',
        customer_id: 'cus_saksham',
        balance: { amount_minor: START - 100_000, currency: 'INR' },
      }),
    );
  });

  it('Aero Core committed but the answer was lost with the Worker → REUSED with details → executed once, done', async () => {
    const sockets = await h.listen('aero');
    const tokens = await hubCore();
    const id = await approved('transfer.saved', transfer);
    const grant = (await workerDies(id, 'after_core')) as SignedGrant;
    await sweep();
    await tick();
    expect(tokens[0]).toBe(grant.token);
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'executed' });
    expect((await entries(id)).at(-1)?.payload).toMatchObject({ earlier_attempt: true });
    expect(events().map((e) => e.event)).toEqual(['done']);
    expect(await balance()).toBe(START - 100_000);
    expect(await uses(grant.claims.jti)).toBe(1);
    // No body on REUSED: the balance comes from a statement read with its own read grant.
    expect(sockets).toContainEqual(
      expect.objectContaining({
        type: 'core_update',
        balance: { amount_minor: START - 100_000, currency: 'INR' },
      }),
    );
    expect((await types(id)).filter((t) => t === 'grant_issued')).toHaveLength(1);
  });

  it('grant expired → never presented; failed unknown, deny E_FAIL_CLOSED, reconcile needed, specialist handoff', async () => {
    const sockets = await h.listen('console');
    const tokens = await hubCore();
    const id = await approved('transfer.saved', transfer);
    const grant = (await workerDies(id, 'after_grant')) as SignedGrant;
    await sweep(grant.claims.exp * 1000 - h.clock.nowMs() - PRESENT_MARGIN_MS);
    await tick();
    expect(tokens).toEqual([]);
    const record = await h.hub.requestState(id);
    expect(record).toMatchObject({
      status: 'failed',
      failure: 'E_FAIL_CLOSED',
      last_event: { event: 'deny', properties: { request_id: id, reason: 'E_FAIL_CLOSED' } },
    });
    expect(record?.handoff_id).toMatch(/^ho_/);
    expect(await types(id)).toEqual(['proposed', 'decided', 'grant_issued', 'core_rejected', 'handoff']);
    const [rejected, handoff] = (await entries(id)).slice(-2);
    expect(rejected?.payload).toMatchObject({
      outcome: 'unknown',
      reconcile: 'needed',
      jti: grant.claims.jti,
      by: 'sweep',
      detail: 'grant_expired',
    });
    expect(handoff?.payload).toMatchObject({
      reasons: expect.arrayContaining(['E_FAIL_CLOSED', 'H_SPECIALIST']),
    });
    expect(events()).toEqual([{ event: 'deny', properties: { request_id: id, reason: 'E_FAIL_CLOSED' } }]);
    expect(sockets).toContainEqual(expect.objectContaining({ type: 'handoff', request_id: id }));
    expect(await hubRows('SELECT request_id FROM executions')).toEqual([]);
  });

  it('still unknown after presenting the same grant (one retry) → failed unknown, reconcile, handoff; never "not executed"', async () => {
    const tokens = await hubCore(async () => new Response('{}', { status: 500 }));
    const id = await approved('transfer.saved', transfer);
    const grant = (await workerDies(id, 'after_grant')) as SignedGrant;
    await sweep();
    expect(tokens).toEqual([grant.token, grant.token]);
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'failed', failure: 'E_FAIL_CLOSED' });
    expect((await entries(id)).find((e) => e.type === 'core_rejected')?.payload).toMatchObject({
      outcome: 'unknown',
      reconcile: 'needed',
      detail: 'represented',
    });
    expect(await types(id)).toContain('handoff');
    expect(events()).toEqual([{ event: 'deny', properties: { request_id: id, reason: 'E_FAIL_CLOSED' } }]);
  });

  it('Aero Core answering an expired grant on the sweep is unknown, not "refused" (it may have run before)', async () => {
    await hubCore(async () =>
      Response.json({ error: { code: 'E_GRANT_EXPIRED', message: 'expired' } }, { status: 401 }),
    );
    const id = await approved('card.freeze', freeze);
    await workerDies(id, 'after_grant');
    await sweep();
    expect((await entries(id)).find((e) => e.type === 'core_rejected')?.payload).toMatchObject({
      outcome: 'unknown',
      reconcile: 'needed',
    });
  });

  it('refused by the bank on the sweep → failed E_CORE_REJECTED, deny, no handoff, the grant left unused', async () => {
    const tokens = await hubCore();
    const id = await approved('fee.waive', { amount_minor: 100, currency: 'INR', fee_id: 'fee_late_oct' });
    const grant = (await workerDies(id, 'after_grant')) as SignedGrant;
    await sweep();
    expect(tokens).toEqual([grant.token]);
    expect(await h.hub.requestState(id)).toMatchObject({
      status: 'failed',
      failure: 'E_CORE_REJECTED',
      handoff_id: null,
    });
    expect(events()).toEqual([{ event: 'deny', properties: { request_id: id, reason: 'E_CORE_REJECTED' } }]);
    expect(await uses(grant.claims.jti)).toBe(0);
    expect(await types(id)).not.toContain('handoff');
  });

  it('no Aero Core configured for the Hub → unknown, reconcile, handoff (it cannot check)', async () => {
    await runInDurableObject(h.raw, (hub: HubDO) => {
      hub.coreTransport = null;
    });
    const id = await approved('card.freeze', freeze);
    await workerDies(id, 'after_grant');
    await sweep();
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'failed', failure: 'E_FAIL_CLOSED' });
    expect(await types(id)).toContain('handoff');
  });

  it('bounded per alarm: SWEEP_BATCH requests per run, the rest on the next alarm', async () => {
    const ids: string[] = [];
    for (let i = 0; i < SWEEP_BATCH + 2; i++)
      ids.push(await approved('card.freeze', { card_last4: String(1000 + i) }));
    for (const id of ids) await workerDies(id, 'after_begin');
    await sweep();
    const statuses = async () => Promise.all(ids.map(async (id) => (await h.hub.requestState(id))?.status));
    expect((await statuses()).filter((s) => s === 'failed')).toHaveLength(SWEEP_BATCH);
    expect(await runDurableObjectAlarm(h.raw)).toBe(true);
    expect(new Set(await statuses())).toEqual(new Set(['failed']));
    expect(events()).toHaveLength(SWEEP_BATCH + 2);
  });
});

describe('the sweep resolves a request that was approved but never claimed', () => {
  // The Worker died after the decision (allow, or a step-up answered yes) but before beginExecution: nothing was
  // signed, nothing reached Aero Core, and nobody is left to tell the call.

  /** A step-up from another phone (its own call), answered yes straight in the Hub; no Worker ever picks it up. */
  async function approvedAfterStepUp(): Promise<string> {
    const number_hash = await registeredNumberHash(bindings.PHONE_HASH_PEPPER, UNREGISTERED);
    await h.hub.identifyCaller({
      run_id: STEP_RUN,
      call_sid: null,
      channel: 'phone',
      region: 'IN',
      number_hash,
      from_last4: UNREGISTERED.slice(-4),
      claimed_name: 'Saksham Mishra',
    });
    const outcome = await h.hub.propose({
      run_id: STEP_RUN,
      call_sid: null,
      channel: 'phone',
      from_number: UNREGISTERED,
      number_hash,
      default_region: 'IN',
      action: 'transfer.saved',
      params_json: JSON.stringify(transfer),
      params_hash: await paramsHash(transfer),
      readback_confirmed: true,
      caller_quotes: [],
      coaching: { score: 0, cues: [] },
      distress: false,
      packs: { IN: IN_PACK, US: US_PACK },
      callback: { available: false, number_hash: null },
    });
    const { request_id } = outcome.record;
    expect(outcome.record.status).toBe('awaiting_confirmation');
    expect(
      await h.hub.resolveConfirmation({ request_id, answer: 'approved', channel: 'passkey' }),
    ).toMatchObject({ accepted: true });
    expect((await h.hub.requestState(request_id))?.status).toBe('approved');
    return request_id;
  }

  const worker = () =>
    flowContext(h.env, h.tenant, {
      clock: h.clock,
      rng: h.rng,
      bolnaFetch: h.bolna.fetch,
      coreTransport: () => h.aero.transport,
    });
  const alarmAt = () =>
    runInDurableObject(h.raw, (_: HubDO, state: DurableObjectState) => state.storage.getAlarm());
  const deny = (id: string) => ({ event: 'deny', properties: { request_id: id, reason: 'E_FAIL_CLOSED' } });

  it('an approval arms the alarm, from a proposal allowed outright and from a step-up answered yes', async () => {
    const id = await approved('card.freeze', freeze);
    const t0 = h.clock.nowMs();
    await h.fireAlarm(); // flush the outboxes: only the approval is left to watch
    expect(await alarmAt()).toBe(t0 + SWEEP_DELAY_MS);
    await executeRequest(worker(), id);
    h.clock.advance(5_000);
    await approvedAfterStepUp();
    await h.fireAlarm();
    expect(await alarmAt()).toBe(h.clock.nowMs() + SWEEP_DELAY_MS);
  });

  it('sweep first: failed, deny E_FAIL_CLOSED (not before 30 s), one event; the late Worker then sends nothing', async () => {
    const id = await approved('transfer.saved', transfer);
    await sweep(SWEEP_DELAY_MS - 1_000);
    expect((await h.hub.requestState(id))?.status).toBe('approved');
    await sweep(2_000);
    expect(await h.hub.requestState(id)).toMatchObject({
      status: 'failed',
      failure: 'E_FAIL_CLOSED',
      handoff_id: null,
      last_event: deny(id),
    });
    expect(events()).toEqual([deny(id)]);
    expect(await types(id)).toEqual(['proposed', 'decided', 'core_rejected']);
    expect((await entries(id)).at(-1)?.payload).toMatchObject({
      code: 'E_FAIL_CLOSED',
      aero_code: null,
      outcome: 'refused',
      by: 'sweep',
      detail: 'not_claimed',
    });
    // The Worker comes back: nothing left to claim, so no grant, no Aero Core call and no second event.
    expect(await executeRequest(worker(), id)).toBeNull();
    expect(events()).toEqual([deny(id)]);
    expect(h.aero.calls).toEqual([]);
    expect(await types(id)).toEqual(['proposed', 'decided', 'core_rejected']);
    expect(await balance()).toBe(START);
    await sweep();
    expect(events()).toHaveLength(1);
  });

  it('Worker first: a claim inside the 30 s is left to the Worker (executed, one done)', async () => {
    const id = await approved('transfer.saved', transfer);
    h.clock.advance(SWEEP_DELAY_MS - 1_000);
    expect(await executeRequest(worker(), id)).toMatchObject({ status: 'executed' });
    await sweep(2_000);
    await sweep();
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'executed' });
    expect(events().map((e) => e.event)).toEqual(['done']);
    expect(await types(id)).toEqual(['proposed', 'decided', 'grant_issued', 'executed']);
    expect(await balance()).toBe(START - 100_000);
  });

  it('a step-up approved by the customer but never claimed is swept the same way', async () => {
    const id = await approvedAfterStepUp();
    await sweep();
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'failed', failure: 'E_FAIL_CLOSED' });
    expect(h.bolna.events.get(STEP_RUN)).toEqual([deny(id)]);
    expect(h.aero.calls).toEqual([]);
    expect(await executeRequest(worker(), id)).toBeNull();
    expect(h.bolna.events.get(STEP_RUN)).toHaveLength(1);
  });

  it('shares the per-alarm bound with executions: SWEEP_BATCH per run, the rest on the next alarm', async () => {
    const ids: string[] = [];
    for (let i = 0; i < SWEEP_BATCH + 2; i++)
      ids.push(await approved('card.freeze', { card_last4: String(2000 + i) }));
    // Half died after claiming, half before.
    for (const id of ids.slice(0, ids.length / 2)) await workerDies(id, 'after_begin');
    await sweep();
    const statuses = async () => Promise.all(ids.map(async (id) => (await h.hub.requestState(id))?.status));
    expect((await statuses()).filter((s) => s === 'failed')).toHaveLength(SWEEP_BATCH);
    expect(await runDurableObjectAlarm(h.raw)).toBe(true);
    expect(new Set(await statuses())).toEqual(new Set(['failed']));
    expect(events()).toHaveLength(SWEEP_BATCH + 2);
  });
});

describe('races between a late Worker and the sweep', () => {
  /** A Worker running the real executeRequest whose Aero Core request waits until `release()`. */
  function stalledWorker(request_id: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const core: CoreTransport = async (request) => {
      await gate;
      return h.aero.transport(request);
    };
    const ctx = flowContext(h.env, h.tenant, {
      clock: h.clock,
      rng: h.rng,
      bolnaFetch: h.bolna.fetch,
      coreTransport: () => core,
    });
    return { run: executeRequest(ctx, request_id), release: () => release() };
  }

  it('a late Worker finishExecution after the sweep finished is a no-op (first finish wins, one event)', async () => {
    await hubCore();
    const id = await approved('transfer.saved', transfer);
    const worker = stalledWorker(id);
    await vi.waitFor(async () => expect(await types(id)).toContain('grant_issued'));
    await sweep();
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'executed' });
    const before = await types(id);
    worker.release();
    expect(await worker.run).toBeNull();
    expect(await types(id)).toEqual(before);
    expect(events().map((e) => e.event)).toEqual(['done']);
    expect(await balance()).toBe(START - 100_000);
    // Direct: any late finish is a no-op too.
    expect(
      await h.hub.finishExecution(id, {
        status: 'failed',
        code: 'E_FAIL_CLOSED',
        http: null,
        outcome: 'unknown',
      }),
    ).toBeNull();
    expect(await h.hub.requestState(id)).toMatchObject({ status: 'executed' });
  });

  it('the Worker and the sweep presenting the same grant at once → exactly one Aero Core write', async () => {
    const id = await approved('transfer.saved', transfer);
    const worker = stalledWorker(id);
    await vi.waitFor(async () => expect(await types(id)).toContain('grant_issued'));
    const hubSide = await heldHubCore();
    h.clock.advance(SWEEP_DELAY_MS + 1_000);
    const alarm = runDurableObjectAlarm(h.raw);
    // Both hold the same grant at Aero Core's door; open both doors together.
    await vi.waitFor(() => expect(hubSide.tokens).toHaveLength(1));
    worker.release();
    await hubSide.open();
    await Promise.all([worker.run, alarm]);
    const jti = (await h.hub.requestState(id))?.execution?.jti as string;
    // The sweep presented the Worker's grant (a later token, if any, is core_update's own statement read).
    expect(grantFromToken(hubSide.tokens[0] as string).claims.jti).toBe(jti);
    expect(await uses(jti)).toBe(1);
    expect(await balance()).toBe(START - 100_000);
    const writes = h.aero.calls.filter((c) => c.path === '/core/transfers');
    expect(writes.map((c) => c.status).sort()).toEqual([200, 401]);
    expect((await types(id)).filter((t) => t === 'executed')).toHaveLength(1);
    expect(events().map((e) => e.event)).toEqual(['done']);
  });

  it('an execution the sweep sees AFTER the Worker recorded a refusal is still put on the ledger, for a human', async () => {
    const id = await approved('transfer.saved', transfer);
    await workerDies(id, 'after_grant');
    const hubSide = await heldHubCore();
    h.clock.advance(SWEEP_DELAY_MS + 1_000);
    const alarm = runDurableObjectAlarm(h.raw);
    await vi.waitFor(() => expect(hubSide.tokens).toHaveLength(1));
    // The stalled Worker's answer lands while the sweep is at Aero Core's door: the bank refused its attempt.
    expect(
      await h.hub.finishExecution(id, {
        status: 'failed',
        code: 'E_BAD_REQUEST',
        http: 400,
        outcome: 'refused',
      }),
    ).toMatchObject({ status: 'failed' });
    await hubSide.open();
    await alarm;
    const record = await h.hub.requestState(id);
    expect(record).toMatchObject({ status: 'failed', failure: 'E_CORE_REJECTED' });
    expect(record?.handoff_id).toMatch(/^ho_/);
    expect(await balance()).toBe(START - 100_000);
    expect(await types(id)).toEqual([
      'proposed',
      'decided',
      'grant_issued',
      'core_rejected',
      'executed',
      'handoff',
    ]);
    expect((await entries(id)).find((e) => e.type === 'executed')?.payload).toMatchObject({
      reconcile: 'needed',
      by: 'sweep',
    });
  });
});
