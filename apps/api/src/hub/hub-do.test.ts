import { HalynError } from '@halyn/shared';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { uniqueTenant } from '../../test/fixtures/api';
import { movableClock, recordingSink } from '../../test/fixtures/hub';
import { hubFor, hubStub } from './client';
import type { HubDO } from './hub-do';
import { toFailure, unwrap } from './result';

// Edge cases of the Hub, run against the real Durable Object in Miniflare. The headline behaviours (ordering under
// concurrency, idempotency, timeouts, first answer wins, the outbox, WebSockets) are in test/int/.

async function hub(clock = movableClock()) {
  const tenant = uniqueTenant();
  const raw = env.HUB.getByName(tenant);
  const sink = recordingSink();
  await runInDurableObject(raw, (instance: HubDO) => {
    instance.clock = clock;
    instance.sink = sink;
  });
  return { tenant, raw, stub: hubStub(env, tenant), client: hubFor(env, tenant), sink, clock };
}

const append = (n: number) => ({ type: 'proposed' as const, ref_id: `req_${n}`, payload: { n } });
const failure = (code: string, message: RegExp) => ({
  ok: false,
  code,
  message: expect.stringMatching(message),
});

describe('Hub results (ADR-014)', () => {
  it('turn a HalynError into a failure value and back, and anything else into E_FAIL_CLOSED', () => {
    expect(toFailure(new HalynError('E_NOT_FOUND', 'gone'))).toEqual({
      ok: false,
      code: 'E_NOT_FOUND',
      message: 'gone',
    });
    expect(toFailure(new Error('x'))).toEqual({
      ok: false,
      code: 'E_FAIL_CLOSED',
      message: 'hub: unexpected error',
    });
    expect(unwrap({ ok: true, value: 1 })).toBe(1);
    expect(() => unwrap({ ok: false, code: 'E_NOT_FOUND', message: 'gone' })).toThrow(HalynError);
  });
});

describe('HubDO tenant binding (invariant 8)', () => {
  it('binds to the first tenant and refuses any other or a malformed id', async () => {
    const { tenant, stub } = await hub();
    expect((await stub.appendLedger(tenant, append(1))).ok).toBe(true);
    expect(await stub.appendLedger('ten_someone_else', append(2))).toEqual(
      failure('E_FAIL_CLOSED', /tenant mismatch/),
    );
    expect(await stub.ledgerHead('not a tenant')).toEqual(failure('E_FAIL_CLOSED', /invalid tenant/));
    expect(await stub.ledgerHead(tenant)).toMatchObject({ ok: true, value: { seq: 1 } });
  });
});

describe('HubDO ledger', () => {
  it('starts empty, then keeps the head and its own copy of every entry', async () => {
    const { client } = await hub();
    expect(await client.ledgerHead()).toBeNull();
    const first = await client.appendLedger(append(1));
    const second = await client.appendLedger(append(2));
    expect(second.prev_hash).toBe(first.hash);
    expect(await client.ledgerHead()).toEqual({ seq: 2, hash: second.hash });
    expect((await client.ledgerEntries(2)).map((e) => e.seq)).toEqual([2]);
    expect(await client.ledgerEntries(1, 1)).toHaveLength(1);
  });

  it('masks phone numbers in payloads before hashing', async () => {
    const { client } = await hub();
    const entry = await client.appendLedger({
      type: 'proposed',
      ref_id: 'req_1',
      payload: { from: '+918065356344' },
    });
    expect(entry.payload).toEqual({ from: '••••6344' });
  });

  it('refuses an invalid append without breaking the lane for the next one', async () => {
    const { tenant, stub, client } = await hub();
    expect(
      await stub.appendLedger(tenant, { type: 'not_a_type' as 'proposed', ref_id: 'req_1', payload: {} }),
    ).toEqual(failure('E_FAIL_CLOSED', /invalid ledger append/));
    await expect(
      client.appendLedger({ type: 'nope' as 'proposed', ref_id: 'x', payload: {} }),
    ).rejects.toBeInstanceOf(HalynError);
    expect((await client.appendLedger(append(1))).seq).toBe(1);
  });

  it('backs off after a sink failure and skips the flush until the retry time', async () => {
    const { raw, client, sink, clock } = await hub();
    sink.failNext = 2;
    await client.appendLedger(append(1));
    await runDurableObjectAlarm(raw); // attempt 1 fails → retry in 2 s
    expect(sink.batches).toHaveLength(0);
    clock.advance(1000);
    await runDurableObjectAlarm(raw); // before the retry time: no attempt
    expect(sink.failNext).toBe(1);
    clock.advance(1500);
    await runDurableObjectAlarm(raw); // attempt 2 fails → retry in 4 s
    expect(sink.failNext).toBe(0);
    clock.advance(4000);
    await runDurableObjectAlarm(raw); // attempt 3 succeeds
    expect(sink.batches.map((b) => b.map((e) => e.seq))).toEqual([[1]]);
    await runDurableObjectAlarm(raw); // nothing left: the sink is not called again
    expect(sink.batches).toHaveLength(1);
  });

  it('persists to TiDB by default and keeps the rows when TiDB is not configured', async () => {
    const tenant = uniqueTenant();
    const raw = env.HUB.getByName(tenant);
    await hubFor(env, tenant).appendLedger(append(1));
    await runDurableObjectAlarm(raw);
    const unpersisted = await runInDurableObject(
      raw,
      (_: HubDO, state) =>
        state.storage.sql
          .exec<{ n: number }>('SELECT COUNT(*) AS n FROM ledger WHERE persisted_at IS NULL')
          .one().n,
    );
    expect(unpersisted).toBe(1);
  });

  it('does nothing on an alarm before any tenant is bound', async () => {
    await runInDurableObject(env.HUB.getByName(uniqueTenant()), async (instance: HubDO) => {
      await instance.alarm();
    });
  });
});

describe('HubDO idempotency', () => {
  it('validates the key and the ttl', async () => {
    const { tenant, stub } = await hub();
    const ok = () => ({ ok: true as const, value: 1 });
    expect(await stub.idempotent(tenant, '', 60, ok)).toEqual(failure('E_FAIL_CLOSED', /idempotency key/));
    expect(await stub.idempotent(tenant, 'k', 0, ok)).toEqual(failure('E_FAIL_CLOSED', /idempotency ttl/));
    expect(await stub.idempotent(tenant, 'k', 86_401, ok)).toEqual(
      failure('E_FAIL_CLOSED', /idempotency ttl/),
    );
  });

  it('recomputes after the ttl, and stores nothing when the compute fails', async () => {
    const { client, clock } = await hub();
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return { calls };
    };
    expect(await client.idempotent('k', 60, compute)).toEqual({ calls: 1 });
    expect(await client.idempotent('k', 60, compute)).toEqual({ calls: 1 });
    clock.advance(61_000);
    expect(await client.idempotent('k', 60, compute)).toEqual({ calls: 2 });
    await expect(
      client.idempotent('boom', 60, async () => {
        throw new HalynError('E_BAD_REQUEST', 'compute failed');
      }),
    ).rejects.toMatchObject({ code: 'E_BAD_REQUEST', message: 'compute failed' });
    expect(await client.idempotent('boom', 60, async () => 'ok')).toBe('ok');
  });

  it('refuses a result that is not JSON', async () => {
    const { tenant, stub } = await hub();
    expect(
      await stub.idempotent(tenant, 'k', 60, () => ({ ok: true, value: undefined as unknown as string })),
    ).toEqual(failure('E_FAIL_CLOSED', /not JSON/));
  });
});

describe('HubDO confirmations', () => {
  it('returns the same deadline when a pending confirmation is started twice', async () => {
    const { client } = await hub();
    const a = await client.startConfirmation({
      request_id: 'req_1',
      channels: ['passkey'],
      timeout_seconds: 60,
    });
    const b = await client.startConfirmation({
      request_id: 'req_1',
      channels: ['passkey'],
      timeout_seconds: 60,
    });
    expect(b).toEqual(a);
    expect(await client.confirmationResult('req_1')).toBeNull();
  });

  it('refuses invalid input, a restart after it settled, and an answer for an unknown request', async () => {
    const { tenant, stub, client } = await hub();
    expect(
      await stub.startConfirmation(tenant, { request_id: 'req_1', channels: [], timeout_seconds: 60 }),
    ).toEqual(failure('E_FAIL_CLOSED', /invalid confirmation/));
    expect(
      await stub.startConfirmation(tenant, {
        request_id: 'req_1',
        channels: ['passkey', 'passkey'],
        timeout_seconds: 60,
      }),
    ).toEqual(failure('E_FAIL_CLOSED', /invalid confirmation/));
    await client.startConfirmation({ request_id: 'req_1', channels: ['callback'], timeout_seconds: 60 });
    await client.resolveConfirmation({ request_id: 'req_1', answer: 'declined', channel: 'callback' });
    expect(
      await stub.startConfirmation(tenant, {
        request_id: 'req_1',
        channels: ['callback'],
        timeout_seconds: 60,
      }),
    ).toEqual(failure('E_FAIL_CLOSED', /already resolved/));
    expect(
      await stub.resolveConfirmation(tenant, {
        request_id: 'req_404',
        answer: 'approved',
        channel: 'passkey',
      }),
    ).toEqual(failure('E_NOT_FOUND', /No such confirmation/));
    expect(
      await stub.resolveConfirmation(tenant, {
        request_id: 'req_1',
        answer: 'maybe' as 'approved',
        channel: 'passkey',
      }),
    ).toEqual(failure('E_FAIL_CLOSED', /invalid confirmation answer/));
  });

  it('records a late answer after a timeout and ignores it', async () => {
    const { raw, client, clock } = await hub();
    await client.startConfirmation({ request_id: 'req_1', channels: ['passkey'], timeout_seconds: 10 });
    clock.advance(10_000);
    expect(await runDurableObjectAlarm(raw)).toBe(true);
    expect(
      await client.resolveConfirmation({ request_id: 'req_1', answer: 'approved', channel: 'passkey' }),
    ).toEqual({
      accepted: false,
      status: 'timeout',
      channel: null,
    });
    const answers = await runInDurableObject(raw, (_: HubDO, state) =>
      state.storage.sql.exec<{ accepted: number }>('SELECT accepted FROM confirmation_answers').toArray(),
    );
    expect(answers).toEqual([{ accepted: 0 }]);
  });
});

describe('HubDO WebSocket endpoint and broadcasts', () => {
  it('answers 404 to anything but a /ws upgrade, 400 to a bad role and 403 to another tenant', async () => {
    const { tenant, raw, client } = await hub();
    await client.ledgerHead(); // binds the tenant
    expect((await raw.fetch('https://hub.internal/other')).status).toBe(404);
    expect((await raw.fetch('https://hub.internal/ws')).status).toBe(404);
    const headers = (role: string, t: string) => ({
      upgrade: 'websocket',
      'x-halyn-role': role,
      'x-halyn-tenant': t,
    });
    expect((await raw.fetch('https://hub.internal/ws', { headers: headers('admin', tenant) })).status).toBe(
      400,
    );
    expect(
      (await raw.fetch('https://hub.internal/ws', { headers: headers('stage', 'ten_other') })).status,
    ).toBe(403);
  });

  it('validates broadcasts and counts sockets per role', async () => {
    const { tenant, stub, client } = await hub();
    expect(await client.sockets()).toEqual({ stage: 0, console: 0, aero: 0, assistant: 0 });
    const message = {
      type: 'handoff' as const,
      at: new Date().toISOString(),
      handoff_id: 'hnd_1',
      request_id: 'req_1',
      reasons: ['H_SPECIALIST' as const],
      status: 'open' as const,
    };
    expect(await client.broadcast(message)).toBe(0);
    expect(await stub.broadcast(tenant, message, ['admin' as 'stage'])).toEqual(
      failure('E_FAIL_CLOSED', /invalid role/),
    );
    expect(await stub.broadcast(tenant, { ...message, type: 'nope' } as unknown as typeof message)).toEqual(
      failure('E_FAIL_CLOSED', /invalid message/),
    );
  });
});
