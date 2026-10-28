import type { HubRole, WsMessage } from '@halyn/shared';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '@/test/fake-websocket';
import { callLine } from '@/test/fixtures';
import { defaultBackoff, useHub } from './use-hub';

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});

/** Lets the ticket promise settle before the next assertion. */
const flush = () => act(async () => {});
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

function setup(token: string | null = 'tok', getTicket?: (role: HubRole) => Promise<string>) {
  const onMessage = vi.fn<(m: WsMessage) => void>();
  const onReconnect = vi.fn();
  let n = 0;
  const tickets = vi.fn(getTicket ?? (async () => `tkt${++n}`));
  const view = renderHook(
    (props: { token: string | null }) =>
      useHub({
        role: 'stage',
        token: props.token,
        getTicket: tickets,
        onMessage,
        onReconnect,
        url: 'ws://hub.test/ws',
        WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
        backoff: (attempt) => 100 * (attempt + 1),
      }),
    { initialProps: { token } },
  );
  return { ...view, onMessage, onReconnect, tickets };
}

describe('useHub', () => {
  it('does not connect or ask for a ticket without a session token', async () => {
    const { result, tickets } = setup(null);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(tickets).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('connects with a one-time ticket and the role, never the session token, then reports open', async () => {
    const { result, tickets } = setup();
    expect(result.current.status).toBe('connecting');
    await flush();
    expect(tickets).toHaveBeenCalledWith('stage');
    expect(FakeWebSocket.last.url).toBe('ws://hub.test/ws?ticket=tkt1&role=stage');
    expect(FakeWebSocket.last.url).not.toContain('tok');
    act(() => FakeWebSocket.last.open());
    expect(result.current.status).toBe('open');
  });

  it('delivers valid messages and drops invalid ones', async () => {
    const { onMessage } = setup();
    await flush();
    act(() => {
      FakeWebSocket.last.open();
      FakeWebSocket.last.send(callLine('caller', 'hello'));
      FakeWebSocket.last.send('not json');
      FakeWebSocket.last.send({ type: 'decision', at: 'x' });
      FakeWebSocket.last.send({ type: 'surprise' });
      FakeWebSocket.last.onmessage?.({ data: new ArrayBuffer(2) } as MessageEvent);
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({ type: 'call_update', text: 'hello' });
  });

  it('reconnects with backoff and a fresh ticket, and asks the caller to refetch, but not on the first open', async () => {
    const { result, onReconnect, tickets } = setup();
    await flush();
    act(() => FakeWebSocket.last.open());
    expect(onReconnect).not.toHaveBeenCalled();

    act(() => FakeWebSocket.last.drop());
    expect(result.current.status).toBe('reconnecting');
    expect(FakeWebSocket.instances).toHaveLength(1);
    await advance(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.url).toContain('ticket=tkt2');

    // the second attempt fails too: a longer wait
    act(() => FakeWebSocket.last.drop());
    await advance(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await advance(100);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(tickets).toHaveBeenCalledTimes(3);

    act(() => FakeWebSocket.last.open());
    expect(result.current.status).toBe('open');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff when the ticket cannot be fetched', async () => {
    let calls = 0;
    const { result } = setup('tok', async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return 'tkt-ok';
    });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.status).toBe('reconnecting');
    await advance(100);
    expect(FakeWebSocket.last.url).toContain('ticket=tkt-ok');
  });

  it('closes the socket on error and on unmount, and stops retrying', async () => {
    const { unmount } = setup();
    await flush();
    const first = FakeWebSocket.last;
    act(() => first.onerror?.());
    expect(first.closed).toBe(true);
    act(() => first.drop());
    await advance(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    unmount();
    await advance(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.closed).toBe(true);
  });

  it('opens nothing when unmounted while the ticket is still on its way', async () => {
    let release: (ticket: string) => void = () => {};
    const { unmount } = setup('tok', () => new Promise<string>((resolve) => (release = resolve)));
    unmount();
    release('late');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('backs off exponentially up to 10 s', () => {
    expect(defaultBackoff(0)).toBeGreaterThanOrEqual(500);
    expect(defaultBackoff(0)).toBeLessThanOrEqual(625);
    expect(defaultBackoff(20)).toBeGreaterThanOrEqual(10_000);
    expect(defaultBackoff(20)).toBeLessThanOrEqual(12_500);
  });
});
