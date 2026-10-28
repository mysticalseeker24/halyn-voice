// pnpm exec tsx scripts/bolna/check-agents.ts <agents/…json>… — the push-time compliance gate, offline: fills the
// placeholders with fake values (nothing secret is read or printed) and prints each file's problems.
import { checkAgent, readAgentFile } from './agent';

const fake = {
  API_URL: 'https://api.example.invalid',
  HALYN_TOOL_SECRET: 'x'.repeat(40),
  SPECIALIST_NUMBER: '+910000000000',
};
for (const f of process.argv.slice(2)) {
  const problems = checkAgent(readAgentFile(f, fake));
  console.log(f, problems.length ? problems : 'compliance ok');
}
