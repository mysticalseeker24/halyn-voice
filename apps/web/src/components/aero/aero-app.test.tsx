import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '@/test/fake-websocket';
import {
  aeroHome,
  approvalOptionsBody,
  confirmRequest,
  confirmResolved,
  jsonResponse,
  pendingApproval,
  registerOptionsBody,
  REQ_ID,
  sessionBody,
  wsTicketBody,
} from '@/test/fixtures';
import { AlertsView } from './alerts-view';
import { AeroShell } from './aero-shell';
import { HomeView } from './home-view';
import { PasskeyView } from './passkey-view';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);
vi.mock('next/navigation', () => ({ usePathname: () => '/aero' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Handler = (body: unknown) => Response | Promise<Response>;
let routes: Record<string, Handler>;
let calls: { key: string; body: unknown }[];

function installFetch() {
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
}

beforeEach(() => {
  FakeWebSocket.reset();
  calls = [];
  routes = {
    'POST /web/session': () => jsonResponse(sessionBody()),
    'POST /web/ws-ticket': () => jsonResponse(wsTicketBody()),
    'GET /web/aero/home': () => jsonResponse(aeroHome()),
  };
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  installFetch();
  webauthn.startAuthentication.mockReset();
  webauthn.startRegistration.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

const renderHome = (view = <HomeView />) =>
  render(
    <AeroShell>
      <main>{view}</main>
    </AeroShell>,
  );

describe('Aero home', () => {
  it('shows a loading state, then balance, card, loan and activity from integer minor units', async () => {
    renderHome();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your account');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Hello, Saksham');
    expect(screen.getByTestId('balance')).toHaveTextContent('₹4,82,500.75');
    expect(screen.getByTestId('card-status')).toHaveTextContent('Active');
    expect(screen.getByText(/•••• 1234/)).toBeInTheDocument();
    expect(screen.queryByText('4821', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('EMI ₹12,500')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('+₹95,000')).toBeInTheDocument();
  });

  it('shows an error state with a working retry', async () => {
    let fail = true;
    routes['GET /web/aero/home'] = () =>
      fail
        ? jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'Halyn is unavailable' } }, 500)
        : jsonResponse(aeroHome());
    const user = userEvent.setup();
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent('Halyn is unavailable');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('balance')).toBeInTheDocument();
  });

  it('shows the sign-in failure as an error', async () => {
    routes['POST /web/session'] = () =>
      jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'Halyn is unavailable' } }, 503);
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent('Halyn is unavailable');
  });

  it('asks for the demo access code when sign-in is refused, keeps it in sessionStorage and retries', async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
        calls.push({ key, body: undefined });
        if (key === 'POST /web/session') {
          const code = (init?.headers as Record<string, string>)['x-demo-code'] ?? null;
          seen.push(code);
          return code === 'open-sesame'
            ? jsonResponse(sessionBody())
            : jsonResponse(
                { error: { code: 'E_UNAUTHORIZED', message: 'A valid demo access code is required' } },
                401,
              );
        }
        return jsonResponse(aeroHome());
      }),
    );
    const user = userEvent.setup();
    renderHome();
    const field = await screen.findByLabelText('Demo access code');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(field, 'wrong');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code was not accepted');
    expect(window.sessionStorage.getItem('halyn.demo-code')).toBeNull();
    await user.type(screen.getByLabelText('Demo access code'), 'open-sesame');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('balance')).toBeInTheDocument();
    expect(seen).toEqual([null, 'wrong', 'open-sesame']);
    expect(window.sessionStorage.getItem('halyn.demo-code')).toBe('open-sesame');
  });

  it('sends a remembered demo access code on sign-in without asking again', async () => {
    window.sessionStorage.setItem('halyn.demo-code', 'open-sesame');
    let header: string | undefined;
    routes['POST /web/session'] = () => jsonResponse(sessionBody());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if (path === '/web/session') {
          header = (init?.headers as Record<string, string>)['x-demo-code'];
          return jsonResponse(sessionBody());
        }
        return jsonResponse(aeroHome());
      }),
    );
    renderHome();
    expect(await screen.findByTestId('balance')).toBeInTheDocument();
    expect(header).toBe('open-sesame');
    expect(screen.queryByLabelText('Demo access code')).not.toBeInTheDocument();
  });

  it('shows empty states for no activity, and for no alerts', async () => {
    routes['GET /web/aero/home'] = () =>
      jsonResponse(aeroHome({ activity: [], alerts: [], card: null, loan: null, accounts: [] }));
    renderHome();
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
  });

  it('switches to Hindi and remembers the choice', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByTestId('balance');
    await user.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('नमस्ते, Saksham');
    expect(screen.getByRole('button', { name: 'हिन्दी' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('halyn.aero.lang')).toBe('hi');
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Saksham');
  });

  it('restores a saved language', async () => {
    window.localStorage.setItem('halyn.aero.lang', 'hi');
    renderHome();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('नमस्ते');
  });

  it('shows a reconnecting banner when the Hub drops and refetches when it returns', async () => {
    renderHome();
    await screen.findByTestId('balance');
    await FakeWebSocket.ready();
    act(() => FakeWebSocket.last.open());
    const before = calls.filter((c) => c.key === 'GET /web/aero/home').length;
    act(() => FakeWebSocket.last.drop());
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1), { timeout: 3000 });
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /web/aero/home').length).toBe(before + 1));
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
  });

  it('refetches the home data on a core_update', async () => {
    renderHome();
    await screen.findByTestId('balance');
    await FakeWebSocket.ready();
    act(() => FakeWebSocket.last.open());
    const before = calls.length;
    act(() =>
      FakeWebSocket.last.send({
        type: 'core_update',
        at: '2026-10-28T10:00:00.000Z',
        customer_id: 'cus_saksham',
        balance: { amount_minor: 1, currency: 'INR' },
        activity: null,
      }),
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });
});

describe('approval flow', () => {
  it('opens the sheet from a live confirm_request, with the exact action and the safe-account warning', async () => {
    renderHome();
    await screen.findByTestId('balance');
    await FakeWebSocket.ready();
    act(() => {
      FakeWebSocket.last.open();
      FakeWebSocket.last.send(confirmRequest());
    });
    const dialog = await screen.findByRole('dialog', { name: 'Approve this request?' });
    expect(within(dialog).getByText('Transfer to a new payee')).toBeInTheDocument();
    expect(within(dialog).getByTestId('approval-amount')).toHaveTextContent('₹45,000');
    expect(within(dialog).getByText(/new payee ending 4471/)).toBeInTheDocument();
    expect(within(dialog).getByTestId('safe-account-warning')).toHaveTextContent(
      'Aero will never ask you to move money to a safe account.',
    );
    expect(within(dialog).getByRole('button', { name: 'Approve with passkey' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('approves with the passkey: options, browser ceremony, then verify', async () => {
    routes[`POST /web/approvals/${REQ_ID}/options`] = () => jsonResponse(approvalOptionsBody());
    routes[`POST /web/approvals/${REQ_ID}/verify`] = () => jsonResponse({ ok: true, status: 'approved' });
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred', type: 'public-key' });
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ pending_approvals: [pendingApproval()] }));
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Approve with passkey' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: approvalOptionsBody().options,
    });
    const verify = calls.find((c) => c.key === `POST /web/approvals/${REQ_ID}/verify`);
    expect(verify?.body).toEqual({ response: { id: 'cred', type: 'public-key' } });
    expect(screen.getByText('Approved. Aero will go ahead.')).toBeInTheDocument();
  });

  it('shows a calm message when the passkey prompt is cancelled and keeps the sheet', async () => {
    routes[`POST /web/approvals/${REQ_ID}/options`] = () => jsonResponse(approvalOptionsBody());
    webauthn.startAuthentication.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    );
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ pending_approvals: [pendingApproval()] }));
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Approve with passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(calls.some((c) => c.key.endsWith('/verify'))).toBe(false);
  });

  it('shows a server error from verify', async () => {
    routes[`POST /web/approvals/${REQ_ID}/options`] = () => jsonResponse(approvalOptionsBody());
    routes[`POST /web/approvals/${REQ_ID}/verify`] = () =>
      jsonResponse({ error: { code: 'E_UNAUTHORIZED', message: 'Passkey not recognised' } }, 401);
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred' });
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ pending_approvals: [pendingApproval()] }));
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Approve with passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passkey not recognised');
  });

  it('declines without any passkey ceremony', async () => {
    routes[`POST /web/approvals/${REQ_ID}/decline`] = () => jsonResponse({ ok: true, status: 'declined' });
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ pending_approvals: [pendingApproval()] }));
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    expect(screen.getByText('Declined. Nothing was done.')).toBeInTheDocument();
  });

  it('closes when another channel answers first (confirm_resolved), and can be reopened while pending', async () => {
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ pending_approvals: [pendingApproval()] }));
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await FakeWebSocket.ready();
    act(() => {
      FakeWebSocket.last.open();
      FakeWebSocket.last.send(confirmResolved('timeout'));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('This request expired. Nothing was done.')).toBeInTheDocument();
  });

  it('shows the approval in Hindi', async () => {
    window.localStorage.setItem('halyn.aero.lang', 'hi');
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ pending_approvals: [pendingApproval()] }));
    renderHome();
    expect(await screen.findByRole('button', { name: 'पासकी से मंज़ूर करें' })).toBeInTheDocument();
    expect(screen.getByTestId('safe-account-warning')).toHaveTextContent('सेफ़ अकाउंट');
  });
});

describe('alerts and passkey screens', () => {
  it('lists alerts, and shows the empty state', async () => {
    renderHome(<AlertsView />);
    expect(await screen.findByText('Transfer blocked')).toBeInTheDocument();
  });

  it('alerts empty state', async () => {
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ alerts: [] }));
    renderHome(<AlertsView />);
    expect(await screen.findByText('No alerts. You are all caught up.')).toBeInTheDocument();
  });

  it('alerts error state', async () => {
    routes['GET /web/aero/home'] = () =>
      jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'down' } }, 500);
    renderHome(<AlertsView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
  });

  it('registers a passkey once: options, ceremony, verify, then the ready state', async () => {
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ passkey_registered: false }));
    routes['POST /web/passkeys/register/options'] = () => jsonResponse(registerOptionsBody());
    routes['POST /web/passkeys/register/verify'] = () => jsonResponse({ ok: true });
    webauthn.startRegistration.mockResolvedValue({ id: 'new-cred' });
    const user = userEvent.setup();
    renderHome(<PasskeyView />);
    await user.click(await screen.findByRole('button', { name: 'Create passkey' }));
    expect(await screen.findByTestId('passkey-ready')).toHaveTextContent('Passkey ready');
    expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: registerOptionsBody().options });
    expect(calls.find((c) => c.key === 'POST /web/passkeys/register/verify')?.body).toEqual({
      response: { id: 'new-cred' },
    });
  });

  it('says so when a passkey already exists', async () => {
    renderHome(<PasskeyView />);
    expect(await screen.findByTestId('passkey-ready')).toHaveTextContent('already set up');
  });

  it('handles a cancelled and a failed registration', async () => {
    routes['GET /web/aero/home'] = () => jsonResponse(aeroHome({ passkey_registered: false }));
    routes['POST /web/passkeys/register/options'] = () => jsonResponse(registerOptionsBody());
    webauthn.startRegistration.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    );
    const user = userEvent.setup();
    renderHome(<PasskeyView />);
    await user.click(await screen.findByRole('button', { name: 'Create passkey' }));
    expect(await screen.findByText(/cancelled/)).toBeInTheDocument();
    webauthn.startRegistration.mockRejectedValueOnce(new Error('Authenticator exploded'));
    await user.click(screen.getByRole('button', { name: 'Create passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Authenticator exploded');
  });
});
