import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantAccessView } from '@/components/aero/assistant-access-view';
import { AeroShell } from '@/components/aero/aero-shell';
import { FakeWebSocket } from '@/test/fake-websocket';
import { aeroHome, approvalOptionsBody, decisionMessage, jsonResponse, NOW, sessionBody, wsTicketBody } from '@/test/fixtures';
import { AssistantApp } from './assistant-app';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);
vi.mock('next/navigation', () => ({ usePathname: () => '/aero/assistant' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const RUN = '7d1e0c2a-2222-4333-8444-555566667777';
const pass = (overrides: Record<string, unknown> = {}) => ({
  id: 'pass_demo',
  assistant_name: "Saksham's Assistant",
  assistant_numbers: ['+918065356379'],
  scopes: [{ action: 'statement.view' }, { action: 'emi.move_date', max_uses: 1 }],
  status: 'active',
  issued_at: NOW,
  expires_at: '2026-11-04T10:00:00.000Z',
  ...overrides,
});

type Handler = (body: unknown) => Response | Promise<Response>;
let routes: Record<string, Handler>;
let calls: { key: string; body: unknown }[];

beforeEach(() => {
  FakeWebSocket.reset();
  calls = [];
  routes = {
    'POST /web/session': () => jsonResponse(sessionBody()),
    'POST /web/ws-ticket': () => jsonResponse(wsTicketBody()),
    'GET /web/aero/home': () => jsonResponse(aeroHome()),
    'GET /web/passes': () => jsonResponse({ passes: [pass()] }),
  };
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const handler = routes[key];
      return handler ? handler(body) : jsonResponse({ error: { code: 'E_NOT_FOUND', message: key } }, 404);
    }),
  );
  webauthn.startAuthentication.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Saksham's Assistant", () => {
  it('shows the Pass card, calls Aero on it and shows the call as it happens', async () => {
    routes['POST /web/assistant/tasks'] = () => jsonResponse({ ok: true, execution_id: RUN }, 201);
    render(<AssistantApp />);
    expect(await screen.findByTestId('pass-card')).toHaveTextContent('HALYN PASS');
    expect(screen.getByTestId('pass-card')).toHaveTextContent('Move EMI date ×1');
    await userEvent.click(screen.getByRole('button', { name: 'Call Aero for me' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /web/assistant/tasks')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /web/assistant/tasks')?.body).toMatchObject({ pass_id: 'pass_demo' });
    expect(await screen.findByText(RUN)).toBeInTheDocument();
    const socket = await FakeWebSocket.ready();
    act(() => {
      socket.send({ type: 'call_update', at: NOW, run_id: RUN, agent: 'assistant', speaker: 'system', text: 'Halyn issued a one-time Pass code for this call (5 minutes, single use).' });
      socket.send(decisionMessage('allow', ['X_PASS_IN_SCOPE']));
      socket.send({ type: 'call_update', at: NOW, run_id: RUN, agent: 'assistant', speaker: 'system', text: 'assistant: I am calling for my customer.\nuser: Thank you, the statement is on its way.' });
    });
    expect(await screen.findByText(/one-time Pass code/)).toBeInTheDocument();
    expect(screen.getAllByText('ALLOWED').length).toBeGreaterThan(0);
    expect(screen.getByText('Thank you, the statement is on its way.')).toBeInTheDocument();
  });

  it('says what to do when there is no active Pass', async () => {
    routes['GET /web/passes'] = () => jsonResponse({ passes: [pass({ status: 'revoked' })] });
    render(<AssistantApp />);
    expect(await screen.findByText(/No active Pass/)).toBeInTheDocument();
  });
});

describe('Aero: authorise an assistant', () => {
  it('issues a Pass with the passkey and revokes one in a tap', async () => {
    routes['POST /web/passes/options'] = () => jsonResponse(approvalOptionsBody());
    routes['POST /web/passes'] = (body) =>
      jsonResponse({ pass: pass({ id: 'pass_new', scopes: (body as { scopes: unknown }).scopes }), token: 'aaa.bbb.ccc' }, 201);
    routes['DELETE /web/passes/pass_demo'] = () => jsonResponse({ pass: pass({ status: 'revoked' }) });
    webauthn.startAuthentication.mockResolvedValue({ id: 'Y3JlZC1pZA', rawId: 'Y3JlZC1pZA', type: 'public-key', response: {} });
    render(
      <AeroShell>
        <main>
          <AssistantAccessView />
        </main>
      </AeroShell>,
    );
    expect(await screen.findAllByTestId('pass-row')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Approve with passkey' }));
    expect(await screen.findByText(/Pass issued/)).toBeInTheDocument();
    const issued = calls.find((c) => c.key === 'POST /web/passes')?.body as { assistant: { numbers: string[] }; scopes: unknown[] };
    expect(issued.assistant.numbers).toEqual(['+918065356379']);
    expect(issued.scopes).toEqual([{ action: 'statement.view' }, { action: 'card.freeze' }, { action: 'emi.move_date', max_uses: 1 }]);
    expect(screen.getAllByTestId('pass-row')).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0] as HTMLElement);
    expect(await screen.findByText('REVOKED')).toBeInTheDocument();
  });
});
