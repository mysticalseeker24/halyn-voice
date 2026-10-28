import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/lib/api/client';
import { COPY } from '@/lib/i18n';
import { jsonResponse } from '@/test/fixtures';
import { CallAero } from './call-aero';

// The SDK is mocked: it asks getSession for the session (our API), then reports its states as the real one does.
const sdk = vi.hoisted(() => ({ sessions: [] as unknown[], stops: 0 }));
vi.mock('@bolna/web-call', () => ({
  BolnaWebCall: class {
    private handlers: Record<string, (arg?: unknown) => void> = {};
    constructor(private readonly options: { getSession: () => Promise<unknown> }) {}
    on(event: string, handler: (arg?: unknown) => void) {
      this.handlers[event] = handler;
      return this;
    }
    async start() {
      sdk.sessions.push(await this.options.getSession());
      this.handlers['state-change']?.('connecting');
      this.handlers['state-change']?.('active');
    }
    async stop() {
      sdk.stops += 1;
      this.handlers['call-end']?.({ reason: 'local-hangup' });
    }
  },
}));

const session = {
  run_id: '7d1e0c2a-2222-4333-8444-555566667777',
  agent_id: 'a',
  expires_in: 120,
  sip_password: 'x',
};
let posts: string[];

beforeEach(() => {
  posts = [];
  sdk.sessions = [];
  sdk.stops = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      posts.push(`${init?.method} ${new URL(url).pathname} ${String(init?.body)}`);
      return jsonResponse(session);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Call Aero', () => {
  it('starts a browser call on a session minted by the API, shows it live, and hangs up', async () => {
    render(<CallAero api={createApiClient({ baseUrl: 'http://api.test' })} copy={COPY.en} />);
    await userEvent.click(screen.getByRole('button', { name: 'Call Aero' }));
    expect(await screen.findByRole('status')).toHaveTextContent('On call with Aero');
    expect(posts).toEqual(['POST /web/calls/session {}']);
    expect(sdk.sessions).toEqual([session]);
    await userEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Call Aero' })).toBeInTheDocument());
    expect(sdk.stops).toBe(1);
  });
});
