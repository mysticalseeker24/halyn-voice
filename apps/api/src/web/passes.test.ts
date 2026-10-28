import {
  type AuthenticationCredentialJson,
  ErrorEnvelopeSchema,
  importVerifyKeys,
  IssuePassResponseSchema,
  ListPassesResponseSchema,
} from '@halyn/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT, type AppHarness, appHarness, SPOKEN, WEB_ORIGIN } from '../../test/fixtures/app';
import type { SoftPasskey } from '../../test/fixtures/webauthn';
import { verifyPassToken } from '../pass';

// Halyn Pass in the Aero app (docs/PASS.md) and the Assistant's call, through the real app, Hub and pass core.

let h: AppHarness;
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

const code = async (res: Response) => ErrorEnvelopeSchema.parse(await res.json()).error.code;

const draft = {
  assistant: { name: "Saksham's Assistant", numbers: [ASSISTANT] },
  scopes: [{ action: 'statement.view' }, { action: 'emi.move_date', max_uses: 1 }],
  expires_in_days: 7,
};

async function consent(passkey: SoftPasskey, body: unknown, token: string): Promise<AuthenticationCredentialJson> {
  const res = await h.web('/web/passes/options', body, token);
  expect(res.status).toBe(200);
  const { options } = (await res.json()) as { options: Parameters<SoftPasskey['authenticate']>[0] };
  return passkey.authenticate(options, WEB_ORIGIN);
}

describe('issuing a Pass with passkey consent', () => {
  it('signs a Pass for exactly the approved draft; listed, ledgered and mirrored', async () => {
    const passkey = await h.registerPasskey();
    const token = await h.customerToken();
    const response = await consent(passkey, draft, token);
    const res = await h.web('/web/passes', { ...draft, response }, token);
    expect(res.status).toBe(201);
    const issued = IssuePassResponseSchema.parse(await res.json());
    expect(issued.pass).toMatchObject({ assistant_numbers: [ASSISTANT], status: 'active', scopes: draft.scopes });
    const verified = await verifyPassToken(
      issued.token,
      await importVerifyKeys(String((h.env as unknown as Record<string, unknown>).HALYN_PUBLIC_JWKS)),
      h.clock.nowMs(),
    );
    expect(verified.ok && verified.claims.pid).toBe(issued.pass.id);
    expect(verified.ok && verified.claims.cnf.customer_passkey_sig).toBe(response.response.signature);

    const list = ListPassesResponseSchema.parse(await (await h.web('/web/passes', undefined, token)).json());
    expect(list.passes.map((p) => p.id)).toEqual(expect.arrayContaining(['pass_demo', issued.pass.id]));
    const ledger = await h.hub.ledgerEntries();
    expect(ledger.some((e) => e.type === 'pass_issued' && e.ref_id === issued.pass.id)).toBe(true);
    await h.fireAlarm();
    expect(h.mirror.items.some((i) => i.kind === 'pass_row' && i.row.id === issued.pass.id)).toBe(true);
    // The same assertion never issues twice.
    expect((await h.web('/web/passes', { ...draft, response }, token)).status).toBe(400);
  });

  it('a signature over one draft cannot issue another (more scopes, longer expiry)', async () => {
    const passkey = await h.registerPasskey();
    const token = await h.customerToken();
    const response = await consent(passkey, draft, token);
    const wider = { ...draft, scopes: [...draft.scopes, { action: 'card.freeze' }] };
    expect((await h.web('/web/passes', { ...wider, response }, token)).status).toBe(400);
    const longer = { ...draft, expires_in_days: 30 };
    expect((await h.web('/web/passes', { ...longer, response }, token)).status).toBe(400);
  });

  it('refuses critical actions (invariant 5), a missing passkey and console sessions', async () => {
    const token = await h.customerToken();
    const critical = { ...draft, scopes: [{ action: 'transfer.new_payee' }] };
    expect((await h.web('/web/passes/options', critical, token)).status).toBe(400);
    const none = await h.web('/web/passes/options', draft, token);
    expect(ErrorEnvelopeSchema.parse(await none.json()).error.message).toMatch(/passkey/i);
    expect(await code(await h.web('/web/passes/options', draft, await h.consoleToken()))).toBe('E_UNAUTHORIZED');
  });
});

describe('revoking a Pass', () => {
  it('revokes at once: the Pass mints no more codes; another customer gets 404', async () => {
    const token = await h.customerToken();
    const other = await h.web('/web/passes/pass_demo', undefined, await h.customerToken('cus_saksham_us'), 'DELETE');
    expect(other.status).toBe(404);
    const res = await h.web('/web/passes/pass_demo', undefined, token, 'DELETE');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pass: { status: string } }).pass.status).toBe('revoked');
    const minted = await h.tool('get_pass_code', {
      run_id: '7d1e0c2a-1111-4333-8444-555566667777',
      pass_token: h.passToken,
      from_number: ASSISTANT,
    });
    expect(minted.status).toBe(400);
    expect((await h.hub.ledgerEntries()).some((e) => e.type === 'pass_revoked')).toBe(true);
  });
});

describe('the Assistant task', () => {
  const task = { task: 'Get my card statement, then move one EMI date to the 10th.', pass_id: 'pass_demo' };

  it('calls Aero from number B on the Pass; only that call gets a code without a token', async () => {
    const token = await h.customerToken();
    const res = await h.web('/web/assistant/tasks', task, token);
    expect(res.status).toBe(201);
    const { execution_id } = (await res.json()) as { execution_id: string };
    const call = h.bolna.calls.find((c) => c.execution_id === execution_id);
    expect(call?.user_data).toMatchObject({ task: task.task, customer_name: SPOKEN, purpose: 'assistant_task' });
    expect(JSON.stringify(call?.user_data)).not.toMatch(/Saksham|eyJ/);

    const minted = await h.tool('get_pass_code', { run_id: execution_id, from_number: ASSISTANT });
    expect(minted.status).toBe(200);
    expect(((await minted.json()) as { code: string }).code).toMatch(/^\d{6}$/);
    const stranger = await h.tool('get_pass_code', {
      run_id: '7d1e0c2a-3333-4333-8444-555566667777',
      from_number: ASSISTANT,
    });
    expect(stranger.status).toBe(400);
  });

  it('refuses a revoked Pass and calls outside 09:00–21:00 IST', async () => {
    const token = await h.customerToken();
    await h.web('/web/passes/pass_demo', undefined, token, 'DELETE');
    expect((await h.web('/web/assistant/tasks', task, token)).status).toBe(400);
    const night = await appHarness({ start: Date.UTC(2026, 10, 2, 17, 0, 0) }); // 22:30 IST
    const late = await night.web('/web/assistant/tasks', task, await night.customerToken());
    expect(late.status).toBe(400);
    expect(night.bolna.calls).toEqual([]);
  });
});

describe('the Assistant app hears the call', () => {
  it('gets a system line when the code is minted and the masked transcript when the call ends', async () => {
    const token = await h.customerToken();
    const res = await h.web('/web/assistant/tasks', { task: 'Get my statement.', pass_id: 'pass_demo' }, token);
    const { execution_id } = (await res.json()) as { execution_id: string };
    const assistant = await h.listen('assistant');
    await h.tool('get_pass_code', { run_id: execution_id, from_number: ASSISTANT });
    await h.settle();
    await h.fetch('/webhooks/bolna', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-halyn-secret': 'test-tool-secret-0123456789abcdef0123456789',
        'cf-connecting-ip': '13.203.39.153',
      },
      body: JSON.stringify({
        id: execution_id,
        status: 'completed',
        transcript: 'assistant: Hello, I am calling for my customer.\nuser: Your account ending 9876543210 is fine.',
      }),
    });
    await h.settle();
    const lines = assistant.filter((m) => m.type === 'call_update');
    expect(lines.map((m) => m.type === 'call_update' && m.agent)).toEqual(['assistant', 'aero']);
    const transcript = lines.at(-1);
    expect(transcript?.type === 'call_update' && transcript.text).toContain('Hello, I am calling');
    expect(JSON.stringify(transcript)).not.toContain('9876543210');
  });
});
