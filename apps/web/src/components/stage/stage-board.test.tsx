import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '@/test/fake-websocket';
import {
  callLine,
  confirmRequest,
  confirmResolved,
  decisionMessage,
  HASH_A,
  jsonResponse,
  ledgerAppend,
  sessionBody,
  wsTicketBody,
} from '@/test/fixtures';
import { StageBoard } from './stage-board';

type Handler = (body: unknown) => Response;
let routes: Record<string, Handler>;
let calls: { key: string; body: unknown }[];

beforeEach(() => {
  FakeWebSocket.reset();
  calls = [];
  routes = {
    'POST /web/session': () => jsonResponse(sessionBody('console')),
    'POST /web/ws-ticket': () => jsonResponse(wsTicketBody()),
    'GET /web/ledger': () => jsonResponse({ entries: [], head_hash: null }),
    'GET /web/ledger/verify': () => jsonResponse({ ok: true, entries: 0, head_hash: null }),
    'POST /web/stage/run/3': () => jsonResponse({ test_run_id: 'run_3', scenario: '3', mode: 'text' }),
    'POST /web/stage/region': () => jsonResponse({ ok: true }),
  };
  window.sessionStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const key = `${init?.method ?? 'GET'} ${u.pathname}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const handler = routes[key];
      return handler ? handler(body) : jsonResponse({ error: { code: 'E_NOT_FOUND', message: key } }, 404);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const send = (...messages: unknown[]) =>
  act(() => {
    for (const m of messages) FakeWebSocket.last.send(m);
  });

describe('Stage board', () => {
  it('has a fixed 1920x1080 canvas and the four scenario buttons', async () => {
    render(<StageBoard />);
    expect(screen.getByText('Signing in to the Hub…')).toBeInTheDocument();
    const canvas = screen.getByTestId('stage-canvas');
    expect(canvas).toHaveStyle({ width: '1920px', height: '1080px' });
    const group = await screen.findByRole('group', { name: 'Scenarios' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['1 · Freeze card', '2 · Fee waiver', '3 · Clone attack', '4 · Coached customer']);
  });

  it('shows empty states in every panel before anything runs', async () => {
    render(<StageBoard />);
    expect(await screen.findByText('No call yet. Pick a scenario above.')).toBeInTheDocument();
    expect(screen.getByText('No confirmation requested.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for a request.')).toBeInTheDocument();
    expect(await screen.findByText(/No ledger entries yet/)).toBeInTheDocument();
    expect(screen.getByText(/Events appear here/)).toBeInTheDocument();
    expect(screen.getByText('Waiting for the first Aero update.')).toBeInTheDocument();
    expect(await screen.findByText(/Chain verified · 0 entries/)).toBeInTheDocument();
  });

  it('shows a sign-in error with retry', async () => {
    routes['POST /web/session'] = () =>
      jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'Halyn is unavailable' } }, 503);
    render(<StageBoard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Halyn is unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks for the demo access code, sends it as x-demo-code and then signs in', async () => {
    const seen: (string | null)[] = [];
    routes['POST /web/session'] = () => jsonResponse(sessionBody('console'));
    const inner = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (new URL(url).pathname === '/web/session') {
          const code = (init?.headers as Record<string, string>)['x-demo-code'] ?? null;
          seen.push(code);
          if (code !== 'open-sesame')
            return jsonResponse(
              { error: { code: 'E_UNAUTHORIZED', message: 'A valid demo access code is required' } },
              401,
            );
        }
        return inner(url, init);
      }),
    );
    const user = userEvent.setup();
    render(<StageBoard />);
    await user.type(await screen.findByLabelText('Demo access code'), 'open-sesame');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('group', { name: 'Scenarios' })).toBeInTheDocument();
    expect(seen).toEqual([null, 'open-sesame']);
    expect(window.sessionStorage.getItem('halyn.demo-code')).toBe('open-sesame');
  });

  it('shows a ledger error, and loads the ledger entries it gets', async () => {
    routes['GET /web/ledger'] = () =>
      jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'ledger down' } }, 500);
    const user = userEvent.setup();
    render(<StageBoard />);
    expect(await screen.findByText('ledger down')).toBeInTheDocument();
    routes['GET /web/ledger'] = () =>
      jsonResponse({
        entries: [
          {
            seq: 1,
            tenant_id: 'ten_aero',
            type: 'proposed',
            ref_id: 'req_1',
            payload: {},
            prev_hash: '0'.repeat(64),
            hash: HASH_A,
            created_at: '2026-10-28T10:00:00.000Z',
          },
        ],
        head_hash: HASH_A,
      });
    routes['GET /web/ledger/verify'] = () => jsonResponse({ ok: true, entries: 1, head_hash: HASH_A });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('proposed')).toBeInTheDocument();
    expect(screen.getByText(/Chain verified · 1 entries/)).toBeInTheDocument();
  });

  it('runs scenario 3 and renders the clone attack: STEP-UP then DENIED, declined via passkey', async () => {
    const user = userEvent.setup();
    render(<StageBoard />);
    await user.click(await screen.findByRole('button', { name: '3 · Clone attack' }));
    expect(calls.find((c) => c.key === 'POST /web/stage/run/3')?.body).toEqual({ mode: 'text' });
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    act(() => FakeWebSocket.last.open());

    send(
      callLine('caller', 'Please send 45,000 rupees to a new account.'),
      decisionMessage('step_up', ['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER']),
      confirmRequest(),
      ledgerAppend(1, 'decided'),
    );
    const decision = screen.getByRole('region', { name: 'Halyn decision' });
    expect(within(decision).getByText('STEP-UP')).toBeInTheDocument();
    expect(within(decision).getAllByText('S_UNREGISTERED_NUMBER')).toHaveLength(2);
    expect(within(decision).getByText(/Signals:/).parentElement).toHaveTextContent('S_UNREGISTERED_NUMBER');
    expect(screen.getByTestId('aero-prompt')).toHaveTextContent('₹45,000');
    expect(screen.getByTestId('confirm-status')).toHaveTextContent('Waiting for the customer');
    expect(
      within(screen.getByRole('list', { name: 'Transcript' })).getByText(/Please send 45,000 rupees/),
    ).toBeInTheDocument();

    routes['GET /web/ledger/verify'] = () => jsonResponse({ ok: true, entries: 1, head_hash: HASH_A });
    send(confirmResolved('declined'), {
      type: 'test_progress',
      at: '2026-10-28T10:00:05.000Z',
      test_run_id: 'run_3',
      scenario_id: '3',
      status: 'passed',
      completed: 1,
      total: 1,
    });
    expect(within(decision).getAllByText(/DENIED/)).toHaveLength(1);
    expect(screen.getByTestId('confirm-status')).toHaveTextContent('DECLINED via passkey');
    expect(screen.queryByTestId('aero-prompt')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Chain verified · 1 entries/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '3 · Clone attack' })).toBeEnabled();
  });

  it('shows a HELD decision with the handoff for the coached customer', async () => {
    render(<StageBoard />);
    await screen.findByRole('group', { name: 'Scenarios' });
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    send(
      decisionMessage('hold', ['S_COACHING', 'H_SPECIALIST']),
      {
        type: 'handoff',
        at: '2026-10-28T10:00:00.000Z',
        handoff_id: 'hnd_1',
        request_id: 'req_01J9ZZZZZZZZZZZZZZZZZZZZZ1',
        reasons: ['S_COACHING'],
        status: 'open',
      },
      {
        type: 'core_update',
        at: '2026-10-28T10:00:00.000Z',
        customer_id: 'cus_saksham',
        balance: { amount_minor: 48_250_075, currency: 'INR' },
        activity: { reference: 'AERO-ABC123', summary: 'Card frozen', amount: null },
      },
    );
    const decision = screen.getByRole('region', { name: 'Halyn decision' });
    expect(within(decision).getByText('HELD')).toBeInTheDocument();
    expect(within(decision).getByText(/Specialist handoff: open/)).toBeInTheDocument();
    expect(screen.getByTestId('stage-balance')).toHaveTextContent('₹4,82,500.75');
  });

  it('shows ALLOWED and DENIED outcomes, and a broken chain', async () => {
    render(<StageBoard />);
    await screen.findByRole('group', { name: 'Scenarios' });
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    send(decisionMessage('allow', ['P_PROTECTIVE']), ledgerAppend(2, 'executed', false));
    const decision = screen.getByRole('region', { name: 'Halyn decision' });
    expect(within(decision).getByText('ALLOWED')).toBeInTheDocument();
    expect(screen.getByText(/Chain BROKEN at #2/)).toBeInTheDocument();
    send(decisionMessage('deny', ['E_FAIL_CLOSED']));
    expect(within(decision).getByText('DENIED')).toBeInTheDocument();
  });

  it('shows a run error and re-enables the buttons', async () => {
    routes['POST /web/stage/run/3'] = () =>
      jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'runner offline' } }, 500);
    const user = userEvent.setup();
    render(<StageBoard />);
    await user.click(await screen.findByRole('button', { name: '3 · Clone attack' }));
    expect(await screen.findByText('runner offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 · Clone attack' })).toBeEnabled();
  });

  it('switches region and reports a region error', async () => {
    const user = userEvent.setup();
    render(<StageBoard />);
    await user.click(await screen.findByRole('button', { name: 'US' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'US' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(calls.find((c) => c.key === 'POST /web/stage/region')?.body).toEqual({ region: 'US' });
    routes['POST /web/stage/region'] = () =>
      jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'no region' } }, 500);
    await user.click(screen.getByRole('button', { name: 'IN' }));
    expect(await screen.findByText('no region')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'US' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('refetches the ledger when the Hub reconnects', async () => {
    render(<StageBoard />);
    await screen.findByText(/Chain verified/);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    act(() => FakeWebSocket.last.open());
    expect(document.querySelector('[data-hub="open"]')).not.toBeNull();
    const before = calls.filter((c) => c.key === 'GET /web/ledger').length;
    act(() => FakeWebSocket.last.drop());
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1), { timeout: 3000 });
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /web/ledger').length).toBe(before + 1));
  });
});

describe('Stage recording mode (Step 19)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('hides the scenario, region and dev controls, keeps the 1920x1080 canvas; Escape brings them back', async () => {
    const user = userEvent.setup();
    render(<StageBoard />);
    await screen.findByRole('group', { name: 'Scenarios' });
    await user.click(screen.getByRole('button', { name: 'Recording mode' }));
    const canvas = screen.getByTestId('stage-canvas');
    expect(canvas).toHaveAttribute('data-recording', 'on');
    expect(canvas).toHaveClass('stage-recording');
    expect(canvas).toHaveStyle({ width: '1920px', height: '1080px' });
    expect(screen.queryByRole('group', { name: 'Scenarios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Region' })).not.toBeInTheDocument();
    expect(screen.queryByText('Text mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recording mode' })).not.toBeInTheDocument();
    expect(window.location.search).toBe('?recording=1');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('group', { name: 'Scenarios' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('starts in recording mode from ?recording=1', async () => {
    window.history.replaceState(null, '', '/stage?recording=1');
    render(<StageBoard />);
    await waitFor(() => expect(screen.getByTestId('stage-canvas')).toHaveAttribute('data-recording', 'on'));
    expect(screen.queryByRole('group', { name: 'Scenarios' })).not.toBeInTheDocument();
  });
});
