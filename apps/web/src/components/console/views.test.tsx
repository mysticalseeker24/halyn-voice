import { compilePolicyPack, PolicyPackSchema } from '@halyn/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ApiClient, createApiClient } from '@/lib/api/client';
import { HASH_A, HASH_B, jsonResponse, NOW, REQ_ID } from '@/test/fixtures';
import {
  CallDetailView,
  CallsView,
  IntegrationsView,
  LedgerView,
  PassesView,
  PoliciesView,
  SignalsView,
} from './views';

// One table over the Console views: each shows loading, an error with a retry, its empty state and its data.

const RUN = '7d1e0c2a-2222-4333-8444-555566667777';
const call = {
  run_id: RUN,
  channel: 'phone',
  region: 'IN',
  customer_id: 'cus_saksham',
  kind: 'human',
  registered: false,
  from_last4: '0042',
  pass_id: null,
  purpose: null,
  started_at: NOW,
  ended_at: NOW,
  requests: 1,
  last_outcome: 'step_up',
  has_recording: true,
};
const request = {
  request_id: REQ_ID,
  run_id: RUN,
  action: 'transfer.new_payee',
  summary: 'Send ₹45,000 to a new payee, account ending 4471',
  outcome: 'step_up',
  final_outcome: 'deny',
  status: 'refused',
  tier: 3,
  base_tier: 3,
  reasons: ['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER'],
  signals: ['S_UNREGISTERED_NUMBER'],
  cues: [],
  coaching_score: 0,
  handoff_id: null,
  created_at: NOW,
};
const pack = compilePolicyPack(
  PolicyPackSchema.parse({
    pack: 'aero-in',
    version: 3,
    region: 'IN',
    currency: 'INR',
    coaching: { threshold: 0.6 },
    confirm: { timeout_seconds: 60, channels: ['passkey', 'callback'] },
    actions: { 'card.freeze': { tier: 0, protective: true, pass_eligible: true } },
    signals: {
      unregistered_number: 1,
      calls_last_hour_gte_3: 1,
      unusual_hour: 1,
      liveness_below_0_3: 1,
      transfers_last_10m_gte_2: 1,
    },
    handoff: { specialist_number_env: 'SPECIALIST_NUMBER' },
  }),
  HASH_A,
);
const pass = {
  id: 'pass_demo',
  customer_id: 'cus_saksham',
  assistant_name: "Saksham's Assistant",
  assistant_numbers: ['+919000000002'],
  scopes: [{ action: 'statement.view' }],
  status: 'active',
  issued_at: NOW,
  expires_at: NOW,
};
const entry = {
  seq: 1,
  tenant_id: 'ten_aero',
  type: 'proposed',
  ref_id: REQ_ID,
  payload: {},
  prev_hash: HASH_B,
  hash: HASH_A,
  created_at: NOW,
};

interface Case {
  name: string;
  view: (api: ApiClient) => ReactElement;
  path: string;
  data: unknown;
  empty: unknown;
  emptyText: RegExp | null;
  shows: RegExp[];
}

const CASES: Case[] = [
  {
    name: 'Calls',
    view: (api) => <CallsView api={api} />,
    path: '/web/calls',
    data: { calls: [call] },
    empty: { calls: [] },
    emptyText: /No calls yet/,
    shows: [/STEP-UP/, /unregistered \(…0042\)/],
  },
  {
    name: 'Call detail',
    view: (api) => <CallDetailView api={api} runId={RUN} />,
    path: `/web/calls/${RUN}`,
    data: {
      call,
      requests: [request],
      handoffs: [],
      transcript: 'user: freeze my card',
      transcript_status: 'ok',
      recording_url: 'https://recordings.example/r.mp3',
    },
    empty: null,
    emptyText: null,
    shows: [/DENIED/, /S_UNREGISTERED_NUMBER/, /freeze my card/, /Listen to the recording/],
  },
  {
    name: 'Policies',
    view: (api) => <PoliciesView api={api} />,
    path: '/web/policies',
    data: { packs: [pack], missing: ['US'] },
    empty: { packs: [], missing: ['IN', 'US'] },
    emptyText: /No packs/,
    shows: [/IN · aero-in v3 · INR/, /Missing pack: US/, /Test this pack/, /tier 0 · protective/],
  },
  {
    name: 'Passes',
    view: (api) => <PassesView api={api} />,
    path: '/web/console/passes',
    data: { passes: [pass] },
    empty: { passes: [] },
    emptyText: /No Passes issued/,
    shows: [/pass_demo/, /ACTIVE/, /View statement/],
  },
  {
    name: 'Signals',
    view: (api) => <SignalsView api={api} />,
    path: '/web/signals',
    data: {
      window: { requests: 1, since: NOW },
      signals: [{ code: 'S_UNREGISTERED_NUMBER', count: 1 }],
      reasons: [{ code: 'P_TIER3_STEP_UP', count: 1 }],
      cues: [],
      latest: [
        {
          request_id: REQ_ID,
          run_id: RUN,
          action: 'transfer.new_payee',
          outcome: 'step_up',
          signals: ['S_UNREGISTERED_NUMBER'],
          cues: [],
          coaching_score: 0,
          created_at: NOW,
        },
      ],
    },
    empty: { window: { requests: 0, since: null }, signals: [], reasons: [], cues: [], latest: [] },
    emptyText: /No requests yet/,
    shows: [/S_UNREGISTERED_NUMBER/, /never what the caller said/, /STEP-UP/],
  },
  {
    name: 'Ledger',
    view: (api) => <LedgerView api={api} />,
    path: '/web/ledger',
    data: { entries: [entry], head_hash: HASH_A },
    empty: { entries: [], head_hash: null },
    emptyText: /No ledger entries/,
    shows: [/proposed/, new RegExp(REQ_ID)],
  },
  {
    name: 'Integrations',
    view: (api) => <IntegrationsView api={api} />,
    path: '/web/integrations',
    data: {
      agents: [
        {
          role: 'aero_in',
          agent_id: 'f02fa07d-54e8-4140-a318-72b816c10a57',
          name: 'Aero',
          status: 'processed',
          restricted: false,
          webhook_host: 'halyn-api.example.dev',
          error: null,
        },
      ],
      guards: { ip_allowlist: true, tool_secret: true, bolna_key: true, sarvam_key: false },
      aero_core: { ok: true, ms: 12 },
      hub: { mirror_backlog: 3, sockets: { stage: 0, console: 1, aero: 0, assistant: 0 } },
    },
    empty: null,
    emptyText: null,
    shows: [/NOT RESTRICTED/, /halyn-api.example.dev/, /HEALTHY/, /3 rows/, /MISSING/],
  },
];

function serve(path: string, body: unknown, status = 200) {
  const fetch = vi.fn(async (url: string) => {
    if (new URL(url).pathname.startsWith(path)) {
      if (status === 0) return new Promise<Response>(() => undefined);
      return status === 200
        ? jsonResponse(body)
        : jsonResponse({ error: { code: 'E_FAIL_CLOSED', message: 'Hub unavailable' } }, status);
    }
    return jsonResponse({ ok: true, entries: 1, head_hash: HASH_A });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const api = () => createApiClient({ baseUrl: 'http://api.test' });

afterEach(() => vi.unstubAllGlobals());

describe.each(CASES)('Console $name', ({ view, path, data, empty, emptyText, shows }) => {
  it('shows a loading state', () => {
    serve(path, data, 0);
    render(view(api()));
    expect(screen.getByRole('status')).toHaveTextContent(/Loading/);
  });

  it('shows an error with a retry that reloads', async () => {
    const fetch = serve(path, data, 500);
    render(view(api()));
    expect(await screen.findByText(/Could not load/)).toBeInTheDocument();
    expect(screen.getByText('Hub unavailable')).toBeInTheDocument();
    const before = fetch.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetch.mock.calls.length).toBeGreaterThan(before);
  });

  it.runIf(emptyText !== null)('shows its empty state', async () => {
    serve(path, empty);
    render(view(api()));
    expect(await screen.findByText(emptyText ?? /never/)).toBeInTheDocument();
  });

  it('shows its data', async () => {
    serve(path, data);
    render(view(api()));
    for (const text of shows) expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
  });
});

describe('Console actions', () => {
  it('revokes an active Pass and reloads', async () => {
    let revoked = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          revoked = true;
          return jsonResponse({ pass: { ...pass, status: 'revoked' } });
        }
        return jsonResponse({ passes: [{ ...pass, status: revoked ? 'revoked' : 'active' }] });
      }),
    );
    render(<PassesView api={api()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('REVOKED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('verifies the chain on demand', async () => {
    serve('/web/ledger', { entries: [entry], head_hash: HASH_A });
    render(<LedgerView api={api()} />);
    await screen.findByText('proposed');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, entries: 3, first_bad_seq: 2 })));
    await userEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByText(/Chain BROKEN at #2/)).toBeInTheDocument();
  });
});
