import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';
/** A WebSocket stand-in for tests: the test opens, sends and closes it by hand. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }
  /** The hook fetches a one-time ticket before it opens a socket: wait until `count` sockets exist. */
  static async ready(count = 1): Promise<FakeWebSocket> {
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(count));
    return FakeWebSocket.last;
  }

  static get last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('no FakeWebSocket created yet');
    return socket;
  }

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }
  send(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
  }
  drop() {
    this.onclose?.();
  }
  close() {
    this.closed = true;
  }
}
