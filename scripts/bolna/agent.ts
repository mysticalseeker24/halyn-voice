// pnpm tsx scripts/bolna/agent.ts create <agents/…json> [--yes|--dry-run]
//                                  update <agent_id> <agents/…json> [--yes|--dry-run]
//                                  get <agent_id> [--out=<file>]
// Works for graph agents (the MCP in this session has no graph-agent tools). Push-time placeholders ({{PROBE_URL}},
// {{HALYN_TOOL_SECRET}}, {{SPECIALIST_NUMBER}}) come from .env / --probe-url and never live in the JSON; snapshots
// written with --out have secrets stripped and numbers masked. Every push is checked against docs/COMPLIANCE.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type Args,
  bolna,
  isMain,
  isRecord,
  parseArgs,
  type PushPlaceholder,
  redact,
  requireYes,
  runCli,
  stripSecrets,
  substitutePlaceholders,
} from './lib';

/** Words that must never appear in an agent we push (scripts/hooks/check-file.mjs, docs/COMPLIANCE.md). */
const BANNED = [
  /\bRBI\b/,
  /\bCBI\b/,
  /\bHDFC\b/,
  /\bICICI\b/,
  /\bSBI\b/,
  /\bFedEx\b/i,
  /\bTRAI\b/,
  /digital arrest/i,
  /\bcustoms\b/i,
];

export interface AgentFile {
  /** Halyn-only metadata, stripped before the push. */
  halyn: { outbound: boolean; note?: string };
  agent_config: Record<string, unknown>;
  agent_prompts: Record<string, unknown>;
}

/** Compliance problems in an agent payload (empty = fine). Pure. */
export function checkAgent(file: AgentFile): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(file);
  if (/bypass_call_guardrails/.test(text)) problems.push('bypass_call_guardrails must never be set');
  for (const re of BANNED) if (re.test(text)) problems.push(`banned wording: ${re.source}`);
  const config = file.agent_config;
  const welcome = typeof config.agent_welcome_message === 'string' ? config.agent_welcome_message : '';
  if (!/\bAI\b/.test(welcome) || !/record/i.test(welcome))
    problems.push('the greeting must disclose an AI and that the call is recorded');
  const guard = config.calling_guardrails;
  if (file.halyn.outbound) {
    if (!isRecord(guard) || guard.call_start_hour !== 9 || guard.call_end_hour !== 21)
      problems.push('outbound agents need calling_guardrails {call_start_hour: 9, call_end_hour: 21}');
  }
  const models = [...text.matchAll(/"model"\s*:\s*"(gpt-5[^"]*)"/g)].length;
  const temps = [...text.matchAll(/"temperature"\s*:\s*1(?![0-9.])/g)].length;
  if (models > 0 && temps === 0) problems.push('GPT-5 family models need temperature 1');
  return problems;
}

export function readAgentFile(path: string, values: Partial<Record<PushPlaceholder, string>>): AgentFile {
  const raw = readFileSync(resolve(path), 'utf8');
  const parsed: unknown = JSON.parse(substitutePlaceholders(raw, values));
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.halyn) ||
    !isRecord(parsed.agent_config) ||
    !isRecord(parsed.agent_prompts)
  )
    throw new Error(`${path}: expected {halyn, agent_config, agent_prompts}`);
  return parsed as unknown as AgentFile;
}

function placeholderValues(args: Args): Partial<Record<PushPlaceholder, string>> {
  const values: Partial<Record<PushPlaceholder, string>> = {};
  const probe = args.options.get('probe-url') ?? process.env.DAY0_PROBE_URL;
  if (probe) values.PROBE_URL = probe.replace(/\/$/, '');
  if (process.env.HALYN_TOOL_SECRET) values.HALYN_TOOL_SECRET = process.env.HALYN_TOOL_SECRET;
  if (process.env.SPECIALIST_NUMBER) values.SPECIALIST_NUMBER = process.env.SPECIALIST_NUMBER;
  return values;
}

function payload(file: AgentFile): Record<string, unknown> {
  return { agent_config: file.agent_config, agent_prompts: file.agent_prompts };
}

async function show(agentId: string, out?: string): Promise<void> {
  const agent = await bolna({ method: 'GET', path: `/v2/agent/${agentId}` });
  const secrets = [process.env.HALYN_TOOL_SECRET ?? '', process.env.BOLNA_API_KEY ?? ''];
  const safe = stripSecrets(agent, secrets);
  if (out) writeFileSync(resolve(out), `${JSON.stringify(safe, null, 2)}\n`);
  const a = isRecord(agent) ? agent : {};
  console.log(
    JSON.stringify({
      id: a.id,
      agent_name: a.agent_name,
      restricted: a.restricted,
      status: a.agent_status,
      saved_to: out ?? null,
    }),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, first, second] = args.positional;
  const dryRun = args.flags.has('dry-run');
  if (command === 'get' && first) return show(first, args.options.get('out'));
  if (command === 'create' && first) {
    requireYes(args, 'create agent');
    const file = readAgentFile(first, placeholderValues(args));
    const problems = checkAgent(file);
    if (problems.length) throw new Error(`refusing to push ${first}:\n- ${problems.join('\n- ')}`);
    const res = await bolna<Record<string, unknown>>({
      method: 'POST',
      path: '/v2/agent',
      body: payload(file),
      dryRun,
    });
    if (res) console.log(JSON.stringify(redact(res)));
    return;
  }
  if (command === 'update' && first && second) {
    requireYes(args, 'update agent');
    const file = readAgentFile(second, placeholderValues(args));
    const problems = checkAgent(file);
    if (problems.length) throw new Error(`refusing to push ${second}:\n- ${problems.join('\n- ')}`);
    const res = await bolna({ method: 'PUT', path: `/v2/agent/${first}`, body: payload(file), dryRun });
    if (res) console.log(JSON.stringify(redact(res)));
    return;
  }
  throw new Error('usage: agent.ts create <file> | update <agent_id> <file> | get <agent_id> [--out=<file>]');
}

if (isMain(import.meta.url)) await runCli(main);
