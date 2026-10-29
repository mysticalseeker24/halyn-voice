// node scripts/bolna/fix-voice-smoke-1.mjs — chat #7 voice smoke round 1 fixes to agents/aero.graph.json and
// scripts/bolna/make-aero-en.mjs (re-run make-aero-en.mjs after). Idempotent: each edit checks its anchor.
// 1. params as quote-free key=value pairs: Bolna pastes %(params)s into a quoted JSON string, so a JSON object broke
//    the request inside Bolna ("Expecting ',' delimiter") and no proposal ever reached Halyn. Quotes: no double
//    quotes, separated by " | ".
// 2. The card on record (last four only) is in the customer's records, so Aero confirms it instead of collecting digits
//    that the 300 ms endpointing splits across turns; digits that do arrive in pieces are joined.
// 3. Hindi filler lines: each tool's pre_call_message and the "are you still there" check were Bolna's English defaults.
import { readFileSync, writeFileSync } from 'node:fs';

function must(cond, what) {
  if (!cond) throw new Error(`anchor missing: ${what}`);
}

// ── agents/aero.graph.json ─────────────────────────────────────────────────────────────────────────────────────────
const path = 'agents/aero.graph.json';
const agent = JSON.parse(readFileSync(path, 'utf8'));
const task = agent.agent_config.tasks[0];
const api = task.tools_config.api_tools;
const llm = task.tools_config.llm_agent.llm_config;
const tool = (name) => api.tools.find((t) => t.name === name);

const propose = tool('propose_action');
must(propose, 'propose_action tool');
propose.parameters.properties.params.description =
  'The details as key=value pairs separated by semicolons. No quotes, no braces, no JSON. Amounts are amount_minor = rupees x 100 (45000 rupees -> 4500000) with currency INR. Keys per action: card.freeze/card.reset_pin card_last4; fee.waive amount_minor, currency, fee_id; transfer.saved amount_minor, currency, payee_id; transfer.new_payee amount_minor, currency, payee_account_last4, payee_ifsc, payee_name (optional); emi.move_date loan_id, new_day 1-28; statement.view/balance.view/account.close account (savings or current); dispute.charge card_last4, amount_minor, currency, merchant; upi.raise_limit amount_minor, currency; loan.new amount_minor, currency, tenure_months; profile.change_mobile new_number with +91; profile.change_email new_email; account.add_owner account, owner_name; wire.international amount_minor, currency, payee_account_last4, swift_bic, payee_country. Examples: card_last4=8812 or amount_minor=4500000; currency=INR; payee_account_last4=4471; payee_ifsc=AERO0000001';
propose.parameters.properties.caller_quotes.description =
  "The caller's last one or two sentences, word for word, without any double quotes. Separate sentences with ' | '.";
propose.pre_call_message = 'जी, एक पल।';
tool('lookup_customer').pre_call_message = 'एक पल, मैं आपकी जानकारी देख रही हूँ।';
tool('verify_pass').pre_call_message = 'एक पल, मैं Pass देख रही हूँ।';

task.task_config.check_user_online_message = 'क्या आप line पर हैं?';
task.task_config.trigger_user_online_message_after = 12;

const recordsAnchor = 'the personal loan is loan_personal_1;';
must(
  llm.agent_information.includes(recordsAnchor) || llm.agent_information.includes('card_last4 8812'),
  'records',
);
if (!llm.agent_information.includes('card_last4 8812'))
  llm.agent_information = llm.agent_information.replace(
    recordsAnchor,
    `${recordsAnchor} the debit card ends in 8812 (card_last4 8812);`,
  );

const understand = llm.nodes.find((n) => n.id === 'understand');
const cardRule =
  'For a card request (freeze, block, बंद करना, रोकना, card खो गया), use the card on record and confirm it, for example "आपका card ending आठ आठ एक दो freeze करना है, सही है?", instead of asking for digits. If the caller does say digits, they may arrive in pieces over several turns: join them until you have four, and never ask again for digits already given.';
must(understand, 'understand node');
if (!understand.prompt.includes('use the card on record'))
  understand.prompt = understand.prompt.replace(
    'Find out exactly what the caller wants and collect the details that request needs.',
    `Find out exactly what the caller wants and collect the details that request needs. ${cardRule}`,
  );
must(understand.prompt.includes('use the card on record'), 'understand rule applied');

const proposeNode = llm.nodes.find((n) => n.id === 'propose');
must(proposeNode, 'propose node');
proposeNode.prompt = proposeNode.prompt.replace(
  'the details as a JSON object in params',
  'the details in params as key=value pairs separated by semicolons with no quotes (for example card_last4=8812)',
);
proposeNode.prompt = proposeNode.prompt.replace(
  "and the caller's last one or two sentences as caller_quotes.",
  "and the caller's last one or two sentences as caller_quotes, without double quotes, separated by ' | '.",
);
must(proposeNode.prompt.includes('key=value pairs'), 'propose node params');
writeFileSync(path, `${JSON.stringify(agent, null, 2)}\n`);
console.log('✓ agents/aero.graph.json');

// ── scripts/bolna/make-aero-en.mjs (the US web agent is generated from the Hindi graph) ─────────────────────────────
const enPath = 'scripts/bolna/make-aero-en.mjs';
let en = readFileSync(enPath, 'utf8');
const enParamsOld = /propose\.parameters\.properties\.params\.description =\n {2}'[^\n]*';/;
must(enParamsOld.test(en) || en.includes('key=value pairs separated by semicolons. No quotes'), 'en params');
en = en.replace(
  enParamsOld,
  "propose.parameters.properties.params.description =\n  'The details as key=value pairs separated by semicolons. No quotes, no braces, no JSON. Amounts are amount_minor = dollars x 100 (8000 dollars -> 800000) with currency USD. Keys per action: card.freeze card_last4; balance.view/statement.view/account.close account (checking); fee.waive amount_minor, currency, fee_id; transfer.saved amount_minor, currency, payee_id; wire.new amount_minor, currency, payee_account_last4, routing_last4; profile.change_mobile new_number with +1; dispute.charge card_last4, amount_minor, currency, merchant; wire.international amount_minor, currency, payee_account_last4, swift_bic, payee_country. Example: amount_minor=800000; currency=USD; payee_account_last4=3310; routing_last4=0021';",
);
en = en.replace(
  'the October late fee of 35 dollars is fee_us_late_oct; account: checking.',
  'the October late fee of 35 dollars is fee_us_late_oct; account: checking; the debit card ends in 2207 (card_last4 2207).',
);
en = en.replace(
  'the details as a JSON object in params',
  'the details in params as key=value pairs separated by semicolons with no quotes (for example card_last4=2207)',
);
en = en.replace(
  "and the caller\\'s last one or two sentences as caller_quotes.",
  "and the caller\\'s last one or two sentences as caller_quotes, without double quotes, separated by \\' | \\'.",
);
if (!en.includes('check_user_online_message'))
  en = en.replace(
    "cfg.agent_name = 'Aero Bank - voice assistant (English, US web)';",
    "cfg.agent_name = 'Aero Bank - voice assistant (English, US web)';\ntask.task_config.check_user_online_message = 'Are you still there?';\nfor (const t of tools.api_tools.tools) if (t.pre_call_message) t.pre_call_message = 'One moment, please.';",
  );
must(en.includes('key=value pairs separated by semicolons with no quotes'), 'en propose node');
writeFileSync(enPath, en);
console.log('✓ scripts/bolna/make-aero-en.mjs');
