import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/lib/api/client';
import { jsonResponse, NOW, REQ_ID } from '@/test/fixtures';
import { HandoffsView } from './handoffs-view';

const handoff = (overrides: Record<string, unknown> = {}) => ({
  id: 'ho_01J9ZZZZZZZZZZZZZZZZZZZZZ1',
  request_id: REQ_ID,
  call_id: 'call_1',
  run_id: '7d1e0c2a-2222-4333-8444-555566667777',
  customer_id: 'cus_saksham',
  action: 'transfer.new_payee',
  summary: 'Send ₹4,80,000 to a new payee, account ending 9020',
  reasons: ['P_TIER3_STEP_UP', 'S_COACHING', 'H_SPECIALIST'],
  reason: 'S_COACHING',
  status: 'open',
  note: null,
  checkin: { at: '2026-10-29T05:30:00.000Z', why: 'coaching', status: 'scheduled' },
  created_at: NOW,
  resolved_at: null,
  ...overrides,
});

let list: unknown[];
let posts: { url: string; body: unknown }[];

beforeEach(() => {
  list = [handoff()];
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action: string; note?: string };
        posts.push({ url: new URL(url).pathname, body });
        list = [handoff({ status: 'blocked', note: body.note ?? null, resolved_at: NOW })];
        return jsonResponse({ ok: true, status: 'blocked' });
      }
      return jsonResponse({ handoffs: list });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Console Handoffs', () => {
  it('shows the hold with its reasons, call and check-in, and blocks it with a note', async () => {
    render(<HandoffsView api={createApiClient({ baseUrl: 'http://api.test' })} />);
    const item = await screen.findByTestId('handoff');
    expect(item).toHaveTextContent('OPEN');
    expect(item).toHaveTextContent('S_COACHING');
    expect(item).toHaveTextContent('7d1e0c2a-2222-4333-8444-555566667777');
    expect(item).toHaveTextContent(/Check-in call.*coaching/);
    await userEvent.type(
      within(item).getByPlaceholderText('Note (optional)'),
      'Coached; customer called back.',
    );
    await userEvent.click(within(item).getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(screen.getByTestId('handoff')).toHaveTextContent('BLOCKED'));
    expect(posts).toEqual([
      {
        url: '/web/handoffs/ho_01J9ZZZZZZZZZZZZZZZZZZZZZ1/resolve',
        body: { action: 'block', note: 'Coached; customer called back.' },
      },
    ]);
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
  });

  it('has an empty state', async () => {
    list = [];
    render(<HandoffsView api={createApiClient({ baseUrl: 'http://api.test' })} />);
    expect(await screen.findByText(/No handoffs yet/)).toBeInTheDocument();
  });
});
