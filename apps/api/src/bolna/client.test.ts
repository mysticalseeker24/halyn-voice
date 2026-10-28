import { HalynError } from '@halyn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import accepted from '../../../../tests/fixtures/bolna/event-accepted.json';
import ended from '../../../../tests/fixtures/bolna/event-call-ended.json';
import queued from '../../../../tests/fixtures/bolna/call-queued.json';
import completed from '../../../../tests/fixtures/bolna/webhook-completed.json';
import { createBolnaClient, type FetchLike, isBolnaRunId } from './client';

// The typed Bolna REST client against recorded (or, until Day-0, documented) responses from tests/fixtures/bolna.

const RUN = 'b1f6c8e2-7d3a-4c1e-9f00-123456789abc';
const AGENT = '00000000-0000-4000-8000-00000000c0f1';

function respond(fixture: Record<string, unknown>, status = Number(fixture._http ?? 200)) {
  const body = Object.fromEntries(Object.entries(fixture).filter(([k]) => !k.startsWith('_')));
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(...answers: (Response | Error)[]) {
  const requests: Request[] = [];
  const fetch: FetchLike = async (request) => {
    requests.push(request);
    const next = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return next!.clone();
  };
  return { fetch, requests };
}

const client = (fetch: FetchLike) =>
  createBolnaClient({ apiKey: 'bn-test', fetch, baseUrl: 'https://bolna.test/', timeoutMs: 1000 });

afterEach(() => vi.restoreAllMocks());

describe('isBolnaRunId', () => {
  it('only UUIDs are live calls', () => {
    expect(isBolnaRunId(RUN)).toBe(true);
    expect(isBolnaRunId('sid:CA1')).toBe(false);
    expect(isBolnaRunId('stage_1')).toBe(false);
  });
});

describe('sendEvent (POST /v1/call/{run_id}/events)', () => {
  it('posts {event, properties} with the bearer key; 202 → delivered', async () => {
    const r = recorder(respond(accepted));
    const result = await client(r.fetch).sendEvent(RUN, {
      event: 'allow',
      properties: { request_id: 'req_1' },
    });
    expect(result).toEqual({ delivered: true });
    const [req] = r.requests;
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe(`https://bolna.test/v1/call/${RUN}/events`);
    expect(req?.headers.get('authorization')).toBe('Bearer bn-test');
    expect(await req?.json()).toEqual({ event: 'allow', properties: { request_id: 'req_1' } });
  });

  it('404 → the call has ended (no retry); the decision stands', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = recorder(respond(ended));
    const result = await client(r.fetch).sendEvent(RUN, {
      event: 'deny',
      properties: { request_id: 'req_1', reason: 'I_NO_PROOF' },
    });
    expect(result).toEqual({ delivered: false, reason: 'call_ended', status: 404 });
    expect(r.requests).toHaveLength(1);
  });

  it('retries once after a 5xx or a network error, and gives up quietly', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const retried = recorder(new Response('busy', { status: 503 }), respond(accepted));
    expect(
      await client(retried.fetch).sendEvent(RUN, { event: 'allow', properties: { request_id: 'req_1' } }),
    ).toEqual({
      delivered: true,
    });
    expect(retried.requests).toHaveLength(2);
    const down = recorder(new Error('reset'));
    expect(
      await client(down.fetch).sendEvent(RUN, { event: 'allow', properties: { request_id: 'req_1' } }),
    ).toEqual({
      delivered: false,
      reason: 'unreachable',
      status: null,
    });
    const refused = recorder(new Response('{}', { status: 422 }));
    expect(
      await client(refused.fetch).sendEvent(RUN, { event: 'allow', properties: { request_id: 'req_1' } }),
    ).toEqual({
      delivered: false,
      reason: 'rejected',
      status: 422,
    });
    expect(refused.requests).toHaveLength(1);
    expect(log.mock.calls.flat().join('\n')).not.toContain('bn-test');
  });

  it('never calls Bolna for a synthetic run id, and refuses an invalid event', async () => {
    const r = recorder(respond(accepted));
    expect(
      await client(r.fetch).sendEvent('sid:CA1', { event: 'allow', properties: { request_id: 'req_1' } }),
    ).toEqual({
      delivered: false,
      reason: 'no_run_id',
      status: null,
    });
    expect(r.requests).toHaveLength(0);
    await expect(
      client(r.fetch).sendEvent(RUN, { event: 'explode', properties: {} } as never),
    ).rejects.toThrow();
  });
});

describe('startCall (POST /call)', () => {
  const call = {
    agent_id: AGENT,
    recipient_phone_number: '+919000000003',
    from_phone_number: '+918065356379',
    user_data: { customer_name: 'सक्षम', request_id: 'req_1', action_summary: 'Freeze the card ending 8812' },
  };

  it('places the call and returns the execution id', async () => {
    const r = recorder(respond(queued));
    expect(await client(r.fetch).startCall(call)).toEqual({ execution_id: queued.execution_id });
    expect(await r.requests[0]?.json()).toEqual(call);
  });

  it('fails closed on a refusal, a bad answer, a network error or a forbidden flag', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(client(recorder(new Response('{}', { status: 400 })).fetch).startCall(call)).rejects.toThrow(
      HalynError,
    );
    await expect(
      client(recorder(new Response('{"x":1}', { status: 200 })).fetch).startCall(call),
    ).rejects.toThrow(HalynError);
    await expect(client(recorder(new Error('down')).fetch).startCall(call)).rejects.toThrow(HalynError);
    await expect(
      client(recorder(respond(queued)).fetch).startCall({
        ...call,
        user_data: { bypass_call_guardrails: true },
      }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      client(recorder(respond(queued)).fetch).startCall({ ...call, agent_id: 'nope' }),
    ).rejects.toThrow();
  });
});

describe('stopCall and getExecution', () => {
  it('stops a queued call; false for a synthetic id or an error', async () => {
    const r = recorder(new Response('{"status":"stopped"}', { status: 200 }));
    expect(await client(r.fetch).stopCall(RUN)).toBe(true);
    expect(r.requests[0]?.url).toBe(`https://bolna.test/call/${RUN}/stop`);
    expect(await client(r.fetch).stopCall('sid:1')).toBe(false);
    expect(await client(recorder(new Error('x')).fetch).stopCall(RUN)).toBe(false);
  });

  it('reads an execution record; null when missing, malformed or unreachable', async () => {
    expect((await client(recorder(respond(completed)).fetch).getExecution(RUN))?.status).toBe('completed');
    expect(await client(recorder(new Response('{}', { status: 404 })).fetch).getExecution(RUN)).toBeNull();
    expect(await client(recorder(new Response('nope', { status: 200 })).fetch).getExecution(RUN)).toBeNull();
    expect(await client(recorder(new Error('x')).fetch).getExecution(RUN)).toBeNull();
  });
});
