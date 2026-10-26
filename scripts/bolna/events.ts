// pnpm tsx scripts/bolna/events.ts <run_id> <event> ['{"key":"value"}'] --yes
// POST /v1/call/{run_id}/events (graph agents only; 202 accepted, 404 once the call has ended).
import { bolna, isMain, isRecord, parseArgs, redact, requireYes, runCli } from './lib';

export const EVENT_NAME = /^[a-z][a-z0-9_]{0,40}$/;

export function buildEvent(
  runId: string,
  event: string,
  properties: unknown,
): { path: string; body: unknown } {
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error('run id must be a UUID (the execution id)');
  if (!EVENT_NAME.test(event)) throw new Error('event name must be lower_snake_case');
  if (!isRecord(properties)) throw new Error('properties must be a JSON object');
  return { path: `/v1/call/${runId}/events`, body: { event, properties } };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [runId, event, props] = args.positional;
  if (!runId || !event) throw new Error('usage: events.ts <run_id> <event> [json] --yes');
  requireYes(args, 'inject event');
  const { path, body } = buildEvent(runId, event, props ? JSON.parse(props) : {});
  const res = await bolna({ method: 'POST', path, body, dryRun: args.flags.has('dry-run') });
  if (res) console.log(JSON.stringify(redact(res)));
}

if (isMain(import.meta.url)) await runCli(main);
