import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AgentFile, checkAgent, readAgentFile } from '../../scripts/bolna/agent';
import { buildCall, inCallingWindow, istHour } from '../../scripts/bolna/call';
import { buildEvent } from '../../scripts/bolna/events';
import { summarise } from '../../scripts/bolna/executions';
import {
  parseArgs,
  redact,
  repoRoot,
  requireYes,
  stripSecrets,
  substitutePlaceholders,
} from '../../scripts/bolna/lib';
import { buildLink } from '../../scripts/bolna/numbers';

const UUID = '1ad15c7b-3483-4c9e-a336-e371ce112b98';
const A = '+918065356344';
const B = '+918065356379';
const ME = '+919000000003';
const at = (iso: string) => new Date(iso);

describe('scripts/bolna/lib', () => {
  it('parses flags, options and positionals', () => {
    const args = parseArgs(['create', 'x.json', '--yes', '--probe-url=https://p.dev/a=b']);
    expect(args.positional).toEqual(['create', 'x.json']);
    expect(args.flags.has('yes')).toBe(true);
    expect(args.options.get('probe-url')).toBe('https://p.dev/a=b');
  });

  it('refuses writes without --yes and allows --dry-run', () => {
    expect(() => requireYes(parseArgs([]), 'create agent')).toThrow(/--yes/);
    expect(() => requireYes(parseArgs(['--yes']), 'x')).not.toThrow();
    expect(() => requireYes(parseArgs(['--dry-run']), 'x')).not.toThrow();
  });

  it('substitutes only the push-time placeholders and flags any left over', () => {
    const out = substitutePlaceholders('{{PROBE_URL}}/t {{customer_name}} {{SPECIALIST_NUMBER}}', {
      PROBE_URL: 'https://p.dev',
      SPECIALIST_NUMBER: ME,
    });
    expect(out).toBe(`https://p.dev/t {{customer_name}} ${ME}`);
    expect(() => substitutePlaceholders('{{PROBE_URL}} {{HALYN_TOOL_SECRET}}', {})).toThrow(/unresolved/);
  });

  it('strips secrets and masks numbers before anything is saved or printed', () => {
    const secret = 's'.repeat(40);
    const snap = JSON.stringify(
      stripSecrets(
        { headers: { 'x-halyn-secret': secret }, api_token: 'Bearer abc', to: ME, note: `key ${secret}` },
        [secret],
      ),
    );
    expect(snap).not.toContain(secret);
    expect(snap).not.toContain('Bearer abc');
    expect(snap).not.toContain(ME);
    expect(JSON.stringify(redact({ k: `bn-${'0123456789abcdef'.repeat(2)}` }))).not.toMatch(
      /bn-[0-9a-f]{20}/,
    );
  });
});

describe('scripts/bolna/agent compliance gate', () => {
  const dir = join(repoRoot, 'agents', 'day0');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.created.json'));
  const values = {
    PROBE_URL: 'https://probe.example.dev',
    HALYN_TOOL_SECRET: 't'.repeat(40),
    SPECIALIST_NUMBER: ME,
  };

  it.each(files)('%s passes the gate once its placeholders are filled', (file) => {
    expect(checkAgent(readAgentFile(join(dir, file), values))).toEqual([]);
  });

  it('flags missing disclosure, guardrails, temperature, banned words and bypass', () => {
    const bad: AgentFile = {
      halyn: { outbound: true },
      agent_config: {
        agent_welcome_message: 'Hello there',
        llm: { model: 'gpt-5.4-mini', temperature: 0.2 },
        note: 'the RBI said so',
        bypass_call_guardrails: true,
      },
      agent_prompts: {},
    };
    const problems = checkAgent(bad).join(' | ');
    for (const expected of [
      'bypass_call_guardrails',
      'RBI',
      'disclose',
      'calling_guardrails',
      'temperature 1',
    ])
      expect(problems).toContain(expected);
  });
});

describe('scripts/bolna/call guards', () => {
  const ok = { agentId: UUID, to: ME, from: B, allowed: [ME, A, B], at: at('2026-10-26T10:00:00Z') };

  it('builds a call inside the IST window with the timezone set', () => {
    expect(istHour(at('2026-10-26T10:00:00Z'))).toBe(15);
    expect(buildCall(ok)).toEqual({
      agent_id: UUID,
      recipient_phone_number: ME,
      from_phone_number: B,
      user_data: { timezone: 'Asia/Kolkata' },
    });
    expect(buildCall({ ...ok, purpose: 'security_demo' }).user_data).toMatchObject({
      purpose: 'security_demo',
    });
  });

  it('refuses unknown recipients, a foreign caller id, bad ids, off-hours and bypass', () => {
    expect(() => buildCall({ ...ok, to: '+911234567890' })).toThrow(/recipient/);
    expect(() => buildCall({ ...ok, from: '+911234567890' })).toThrow(/caller id/);
    expect(() => buildCall({ ...ok, agentId: 'nope' })).toThrow(/UUID/);
    expect(() => buildCall({ ...ok, at: at('2026-10-26T16:00:00Z') })).toThrow(/window/); // 21:30 IST
    expect(() => buildCall({ ...ok, at: at('2026-10-26T03:00:00Z') })).toThrow(/window/); // 08:30 IST
    expect(() => buildCall({ ...ok, userData: { bypass_call_guardrails: true } })).toThrow(/forbidden/);
  });

  it('opens at 09:00 and closes at 21:00 IST', () => {
    expect(inCallingWindow(at('2026-10-26T03:30:00Z'))).toBe(true); // 09:00 IST
    expect(inCallingWindow(at('2026-10-26T15:29:59Z'))).toBe(true); // 20:59 IST
    expect(inCallingWindow(at('2026-10-26T15:30:00Z'))).toBe(false); // 21:00 IST
  });
});

describe('scripts/bolna events, numbers, executions', () => {
  it('builds an event request and validates its parts', () => {
    expect(buildEvent(UUID, 'allow', { request_id: 'req_1' })).toEqual({
      path: `/v1/call/${UUID}/events`,
      body: { event: 'allow', properties: { request_id: 'req_1' } },
    });
    expect(() => buildEvent('x', 'allow', {})).toThrow(/UUID/);
    expect(() => buildEvent(UUID, 'Allow!', {})).toThrow(/snake_case/);
    expect(() => buildEvent(UUID, 'allow', [])).toThrow(/object/);
  });

  it('builds an inbound link body', () => {
    expect(buildLink(UUID, UUID)).toEqual({ agent_id: UUID, phone_number_id: UUID });
    expect(() => buildLink('x', UUID)).toThrow(/UUID/);
  });

  it('summarises an execution with numbers masked', () => {
    const s = JSON.stringify(
      summarise({
        id: UUID,
        status: 'completed',
        user_number: ME,
        transcript: `call me on ${ME}`,
        total_cost: 4.09,
      }),
    );
    expect(s).toContain('completed');
    expect(s).not.toContain(ME);
  });
});
