#!/usr/bin/env node
// Claude Code PostToolUse hook: blocks secrets, stray real phone numbers, and non-protective wording in Bolna prompts.
// Exit 2 = feedback to Claude (the edit stays, Claude must fix it). Exit 0 = fine.
import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { process.exit(0); }
let filePath;
try { filePath = JSON.parse(input)?.tool_input?.file_path; } catch { process.exit(0); }
if (!filePath || !existsSync(filePath)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const rel = relative(root, filePath).replaceAll('\\', '/');
if (rel.startsWith('node_modules/') || rel.includes('/node_modules/') || rel.endsWith('.env.example')) process.exit(0);
if (/(^|\/)\.env(\.|$)|\.dev\.vars$/.test(rel)) process.exit(0); // env files are allowed to hold secrets (and are git-ignored)

const text = readFileSync(filePath, 'utf8');
const problems = [];

// 1. Secrets
const secretPatterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'API key (sk-...)'],
  [/\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{16,}["']/i, 'hard-coded credential'],
  [/\bBearer\s+[A-Za-z0-9_\-.]{24,}/, 'hard-coded bearer token'],
];
for (const [re, label] of secretPatterns) if (re.test(text)) problems.push(`Possible ${label}. Move it to .env / wrangler secret.`);

// 2. Real Indian mobile numbers other than the project's own Bolna numbers and test numbers
const allowed = new Set(['+918065356344', '+918065356379', '+919000000001', '+919000000002', '+919000000003']);
for (const m of text.matchAll(/\+91[\s-]?([6-9]\d{4})[\s-]?(\d{5})\b/g)) {
  const n = `+91${m[1]}${m[2]}`;
  if (!allowed.has(n)) problems.push(`Real-looking phone number ${n.slice(0, 5)}…${n.slice(-4)}: use CUSTOMER_PHONE from env or a +9190000000xx test number.`);
}

// 3. Bolna prompts must stay protective (docs/COMPLIANCE.md)
if (rel.startsWith('prompts/') || rel.startsWith('agents/')) {
  const banned = [/\bRBI\b/, /\bCBI\b/, /\bHDFC\b/, /\bICICI\b/, /\bSBI\b/, /\bFedEx\b/i, /\bTRAI\b/, /digital arrest/i, /\bcustoms\b/i, /bypass_call_guardrails\s*["']?\s*:\s*true/];
  for (const re of banned) if (re.test(text)) problems.push(`Prompt/agent file contains "${re.source}". Bolna prompts must be protective only, with no real institution names or scam narratives (detection lives in code).`);
}

// 4. Saksham's name: सक्षम (short "Sa"), never a long-vowel or श spelling (CLAUDE.md §8). The wrong spellings are
// built from code points so this file never contains them.
const cp = (hex) => hex.split(' ').map((h) => String.fromCharCode(parseInt(h, 16))).join('');
const misspelt = ['0938 093e 0915 094d 0937 092e', '0938 093e 0915 094d 0936 092e', '0938 0915 094d 0936 092e'].map(cp);
if (misspelt.some((w) => text.includes(w)) || /Sa{2}ksham|Saksha{2}m/.test(text))
  problems.push('Misspelt name: Saksham is "सक्षम मिश्रा" in Devanagari (short "Sa"), "Saksham" in Roman script.');

if (problems.length) {
  console.error(`[halyn hook] ${rel}:\n- ${problems.join('\n- ')}`);
  process.exit(2);
}
process.exit(0);
