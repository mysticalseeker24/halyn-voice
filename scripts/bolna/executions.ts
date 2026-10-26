// pnpm tsx scripts/bolna/executions.ts get <execution_id> [--out=<file>]
// GET /executions/{id}: status, duration, cost, transcript, tool calls and latency, with phone numbers masked.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bolna, isMain, isRecord, parseArgs, redact, runCli } from './lib';

/** The fields a Day-0 check needs, masked. Pure. */
export function summarise(execution: unknown): Record<string, unknown> {
  const e = isRecord(execution) ? execution : {};
  const cost = isRecord(e.cost_breakdown) ? e.cost_breakdown : {};
  return redact({
    id: e.id,
    status: e.status,
    duration_s: e.conversation_duration,
    total_cost_cents: e.total_cost,
    cost_breakdown: {
      platform: cost.platform,
      network: cost.network,
      llm: cost.llm,
      transfer: cost.transfer_cost,
    },
    transcript: e.transcript,
    tool_call_logs: e.tool_call_logs,
    transfer_call_data: e.transfer_call_data,
    from_number: e.user_number,
    agent_number: e.agent_number,
    hangup: isRecord(e.telephony_data) ? e.telephony_data.hangup_reason : undefined,
  }) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, id] = args.positional;
  if (command !== 'get' || !id || !/^[0-9a-f-]{36}$/.test(id))
    throw new Error('usage: executions.ts get <execution_id>');
  const execution = await bolna({ method: 'GET', path: `/executions/${id}` });
  const out = args.options.get('out');
  if (out) writeFileSync(resolve(out), `${JSON.stringify(redact(execution), null, 2)}\n`);
  console.log(JSON.stringify(summarise(execution), null, 2));
}

if (isMain(import.meta.url)) await runCli(main);
