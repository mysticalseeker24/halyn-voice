// pnpm tsx scripts/bolna/numbers.ts link <phone_number_id> <agent_id> --yes
//                                    unlink <phone_number_id> --yes
// POST /inbound/setup and /inbound/unlink. Relinking number A needs Saksham's go-ahead (CLAUDE.md §3); the agent
// that was linked before is never deleted.
import { bolna, isMain, parseArgs, redact, requireYes, runCli } from './lib';

const UUID = /^[0-9a-f-]{36}$/;

export function buildLink(
  phoneNumberId: string,
  agentId: string,
): { agent_id: string; phone_number_id: string } {
  if (!UUID.test(phoneNumberId) || !UUID.test(agentId))
    throw new Error('phone number id and agent id must be UUIDs');
  return { agent_id: agentId, phone_number_id: phoneNumberId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, numberId, agentId] = args.positional;
  const dryRun = args.flags.has('dry-run');
  if (command === 'link' && numberId && agentId) {
    requireYes(args, 'link inbound number');
    const res = await bolna({
      method: 'POST',
      path: '/inbound/setup',
      body: buildLink(numberId, agentId),
      dryRun,
    });
    if (res) console.log(JSON.stringify(redact(res)));
    return;
  }
  if (command === 'unlink' && numberId) {
    requireYes(args, 'unlink inbound number');
    if (!UUID.test(numberId)) throw new Error('phone number id must be a UUID');
    const res = await bolna({
      method: 'POST',
      path: '/inbound/unlink',
      body: { phone_number_id: numberId },
      dryRun,
    });
    if (res) console.log(JSON.stringify(redact(res)));
    return;
  }
  throw new Error(
    'usage: numbers.ts link <phone_number_id> <agent_id> --yes | unlink <phone_number_id> --yes',
  );
}

if (isMain(import.meta.url)) await runCli(main);
