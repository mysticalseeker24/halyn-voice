// pnpm tsx scripts/bolna/call.ts <agent_id> <to: customer|specialist|a|b> [--from=b|a] [--purpose=security_demo]
//                                 [--user-data='{"k":"v"}'] --yes
// Outbound call through Bolna's POST /call. Refuses any recipient that isn't one of Saksham's numbers or our own
// Bolna numbers, refuses outside 09:00–21:00 IST, and never sends bypass_call_guardrails (docs/COMPLIANCE.md).
import { bolna, env, isMain, isRecord, parseArgs, redact, requireYes, runCli } from './lib';

export type Recipient = 'customer' | 'specialist' | 'a' | 'b';
const RECIPIENT_ENV: Record<Recipient, string> = {
  customer: 'CUSTOMER_PHONE',
  specialist: 'SPECIALIST_NUMBER',
  a: 'NUMBER_A',
  b: 'NUMBER_B',
};

export function isRecipient(value: string | undefined): value is Recipient {
  return value !== undefined && value in RECIPIENT_ENV;
}

/** Hour of day in India for a UTC instant. Pure. */
export function istHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(
      at,
    ),
  );
}

/** 09:00 ≤ IST time < 21:00 (the guardrail window every outbound agent also carries). */
export function inCallingWindow(at: Date): boolean {
  const hour = istHour(at);
  return hour >= 9 && hour < 21;
}

export interface CallRequest {
  agent_id: string;
  recipient_phone_number: string;
  from_phone_number: string;
  user_data: Record<string, unknown>;
}

/** Build the /call body; throws on anything the compliance rules forbid. Pure (numbers passed in). */
export function buildCall(input: {
  agentId: string;
  to: string;
  from: string;
  allowed: readonly string[];
  userData?: Record<string, unknown>;
  purpose?: string;
  at: Date;
}): CallRequest {
  if (!/^[0-9a-f-]{36}$/.test(input.agentId)) throw new Error('agent id must be a UUID');
  if (!input.allowed.includes(input.to)) throw new Error('recipient is not one of the allowed numbers');
  if (!input.allowed.includes(input.from)) throw new Error('caller id must be one of our Bolna numbers');
  if (!inCallingWindow(input.at)) throw new Error('outside the 09:00–21:00 IST calling window');
  const userData = { ...(input.userData ?? {}), timezone: 'Asia/Kolkata' };
  if (JSON.stringify(userData).includes('bypass_call_guardrails'))
    throw new Error('bypass_call_guardrails is forbidden');
  if (input.purpose) Object.assign(userData, { purpose: input.purpose });
  return {
    agent_id: input.agentId,
    recipient_phone_number: input.to,
    from_phone_number: input.from,
    user_data: userData,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [agentId, toKey] = args.positional;
  const fromKey = args.options.get('from') ?? 'b';
  if (!agentId || !isRecipient(toKey) || !isRecipient(fromKey))
    throw new Error(
      'usage: call.ts <agent_id> <customer|specialist|a|b> [--from=b] [--user-data=json] --yes',
    );
  requireYes(args, 'outbound call');
  const allowed = Object.values(RECIPIENT_ENV)
    .map((name) => process.env[name]?.trim())
    .filter((n): n is string => Boolean(n));
  const userDataRaw = args.options.get('user-data');
  const parsed: unknown = userDataRaw ? JSON.parse(userDataRaw) : {};
  if (!isRecord(parsed)) throw new Error('--user-data must be a JSON object');
  const body = buildCall({
    agentId,
    to: env(RECIPIENT_ENV[toKey]),
    from: env(RECIPIENT_ENV[fromKey]),
    allowed,
    userData: parsed,
    purpose: args.options.get('purpose'),
    at: new Date(),
  });
  const res = await bolna({ method: 'POST', path: '/call', body, dryRun: args.flags.has('dry-run') });
  if (res) console.log(JSON.stringify(redact(res)));
}

if (isMain(import.meta.url)) await runCli(main);
