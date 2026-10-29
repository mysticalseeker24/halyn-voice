// node scripts/bolna/fix-voice-smoke-2.mjs — chat #7 voice smoke, retried call 1: the `done` event reached the call
// and moved it to `confirmed`, but Bolna left `{{reference}}` unfilled in that LLM node's prompt (it reached the LLM
// as "{reference}"), so Aero said "decision आएगा तो बताऊँगी" instead of "done". `protect` uses `{{reason}}` the same
// way. Both now work without the substitution (and still use the value when Bolna fills it). Idempotent.
// Re-run scripts/bolna/make-aero-en.mjs after.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'agents/aero.graph.json';
const agent = JSON.parse(readFileSync(path, 'utf8'));
const nodes = agent.agent_config.tasks[0].tools_config.llm_agent.llm_config.nodes;
const node = (id) => {
  const n = nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};

node('confirmed').prompt =
  'Halyn has confirmed that the request you submitted is complete. Say in the caller\'s language that it is done, in one short sentence built from the details you read back, for example: "हो गया! आपका card ending आठ आठ एक दो अब freeze है।" Reference: {{reference}}. If that reference reads AERO followed by six characters, say "AERO" and then each character one by one; if it is a placeholder in braces, skip the reference. Then ask if there is anything else: "और कुछ मदद करूँ?"';

const protect = node('protect');
const protectNote =
  ' If the reason above is a placeholder in braces, decide from the conversation which case fits.';
if (!protect.prompt.includes('placeholder in braces'))
  protect.prompt = protect.prompt.replace(
    /\(reason \{\{reason\}\}\)\./,
    `(reason {{reason}}).${protectNote}`,
  );
if (!protect.prompt.includes('placeholder in braces')) throw new Error('protect anchor missing');
writeFileSync(path, `${JSON.stringify(agent, null, 2)}\n`);
console.log('✓ agents/aero.graph.json');

const enPath = 'scripts/bolna/make-aero-en.mjs';
let en = readFileSync(enPath, 'utf8');
const enConfirmed = / {2}confirmed:\n {4}'[^\n]*',\n/;
if (!enConfirmed.test(en)) throw new Error('en confirmed anchor missing');
en = en.replace(
  enConfirmed,
  '  confirmed:\n    \'Halyn has confirmed that the request you submitted is complete. Say that it is done, in one short sentence built from the details you read back, for example: "Done! The wire of eight thousand dollars is on its way." Reference: {{reference}}. If that reference reads AERO followed by six characters, say "AERO" and then each character one by one; if it is a placeholder in braces, skip the reference. Then ask if there is anything else.\',\n',
);
if (!en.includes('placeholder in braces, decide from the conversation'))
  en = en.replace(
    '(reason {{reason}}). In two or three short sentences, without blaming them:',
    '(reason {{reason}}). If the reason above is a placeholder in braces, decide from the conversation which case fits. In two or three short sentences, without blaming them:',
  );
if (!en.includes('placeholder in braces, decide from the conversation'))
  throw new Error('en protect anchor missing');
writeFileSync(enPath, en);
console.log('✓ scripts/bolna/make-aero-en.mjs');
