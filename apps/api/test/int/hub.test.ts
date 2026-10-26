import { verifyLedgerChain } from '@halyn/shared';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hubFor } from '../../src/hub/client';
import type { HubDO } from '../../src/hub/hub-do';
import { uniqueTenant } from '../fixtures/api';
import { movableClock, recordingSink } from '../fixtures/hub';

// The Hub's headline guarantees, each from many separate RPC requests into the real Durable Object.

async function setup() {
  const tenant = uniqueTenant();
  const raw = env.HUB.getByName(tenant);
  const clock = movableClock();
  const sink = recordingSink();
  await runInDurableObject(raw, (instance: HubDO) => {
    instance.clock = clock;
    instance.sink = sink;
  });
  return { tenant, raw, clock, sink, hub: hubFor(env, tenant) };
}

describe('ordered ledger appends (invariant 6)', () => {
  it('50 concurrent appends from separate requests get seq 1..50 and one valid chain', async () => {
    const { hub, tenant } = await setup();
    // A fresh client (stub) per append, as 50 separate Worker requests would have.
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        hubFor(env, tenant).appendLedger({ type: 'proposed', ref_id: `req_${i}`, payload: { i } }),
      ),
    );
    expect(results.map((e) => e.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    const entries = await hub.ledgerEntries();
    expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const head = await hub.ledgerHead();
    expect(head?.seq).toBe(50);
    expect(await verifyLedgerChain(entries, { anchor: head ?? undefined })).toEqual({
      ok: true,
      entries: 50,
      head_hash: head?.hash,
    });
  });

  it('flushes the outbox to the sink strictly in seq order, and retries after a sink failure', async () => {
    const { hub, raw, sink, clock } = await setup();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        hub.appendLedger({ type: 'decided', ref_id: `req_${i}`, payload: {} }),
      ),
    );
    sink.failNext = 1;
    await runDurableObjectAlarm(raw); // TiDB down: nothing persisted, rows kept
    expect(sink.batches).toEqual([]);
    clock.advance(2_000);
    await runDurableObjectAlarm(raw);
    expect(sink.batches.flat().map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    await hub.appendLedger({ type: 'executed', ref_id: 'req_9', payload: {} });
    await runDurableObjectAlarm(raw);
    expect(sink.batches.flat().map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('idempotency (invariant 7)', () => {
  it('returns the identical stored result for repeats and for concurrent duplicates, computing once', async () => {
    const { hub } = await setup();
    let calls = 0;
    const compute = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { request_id: `req_${calls}`, status: 'pending' };
    };
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => hub.idempotent('run_1:hash', 300, compute)),
    );
    const repeat = await hub.idempotent('run_1:hash', 300, compute);
    expect(calls).toBe(1);
    for (const result of [...concurrent, repeat])
      expect(result).toEqual({ request_id: 'req_1', status: 'pending' });
    expect(await hub.idempotent('run_1:other-hash', 300, compute)).toEqual({
      request_id: 'req_2',
      status: 'pending',
    });
  });
});

describe('confirmations (invariant 10)', () => {
  it('the alarm turns an unanswered confirmation into a timeout', async () => {
    const { hub, raw, clock } = await setup();
    const { deadline } = await hub.startConfirmation({
      request_id: 'req_7',
      channels: ['passkey', 'callback'],
      timeout_seconds: 60,
    });
    expect(Date.parse(deadline)).toBe(clock.nowMs() + 60_000);
    clock.advance(59_999);
    await runDurableObjectAlarm(raw);
    expect(await hub.confirmationResult('req_7')).toBeNull();
    clock.advance(1);
    await runDurableObjectAlarm(raw);
    expect(await hub.confirmationResult('req_7')).toEqual({
      accepted: true,
      status: 'timeout',
      channel: null,
    });
    const pending = await runInDurableObject(raw, (_: HubDO, state) =>
      state.storage.sql.exec('SELECT * FROM pending_confirmations').toArray(),
    );
    expect(pending).toEqual([]);
    const types = (await hub.ledgerEntries()).map((e) => [e.type, e.payload]);
    expect(types).toEqual([
      ['confirm_requested', { channels: ['passkey', 'callback'], expires_at: deadline }],
      ['confirmed', { status: 'timeout', channel: null, reason: 'C_TIMEOUT' }],
    ]);
  });

  it('the first answer wins; later answers are recorded and ignored', async () => {
    const { hub, raw } = await setup();
    await hub.startConfirmation({
      request_id: 'req_8',
      channels: ['passkey', 'callback'],
      timeout_seconds: 60,
    });
    const [first, second] = await Promise.all([
      hub.resolveConfirmation({ request_id: 'req_8', answer: 'declined', channel: 'passkey' }),
      hub.resolveConfirmation({ request_id: 'req_8', answer: 'approved', channel: 'callback' }),
    ]);
    expect(first).toEqual({ accepted: true, status: 'declined', channel: 'passkey' });
    expect(second).toEqual({ accepted: false, status: 'declined', channel: 'passkey' });
    expect(await hub.confirmationResult('req_8')).toEqual({
      accepted: true,
      status: 'declined',
      channel: 'passkey',
    });
    const answers = await runInDurableObject(raw, (_: HubDO, state) =>
      state.storage.sql
        .exec<{ answer: string; accepted: number }>(
          'SELECT answer, accepted FROM confirmation_answers ORDER BY id',
        )
        .toArray(),
    );
    expect(answers).toEqual([
      { answer: 'declined', accepted: 1 },
      { answer: 'approved', accepted: 0 },
    ]);
    expect((await hub.ledgerEntries()).filter((e) => e.type === 'confirmed')).toHaveLength(1);
  });
});
