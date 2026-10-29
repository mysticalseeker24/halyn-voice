// Summarise `wrangler tail --format json` output: cpuTime / wallTime per request path (and DO events).
// Usage (repo root): node scripts/ops/tail-cpu.mjs scripts/out/tail.jsonl
import { readFileSync } from 'node:fs';

const text = readFileSync(process.argv[2], 'utf8');
const events = [];
let depth = 0;
let start = -1;
let inString = false;
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  if (inString) {
    if (ch === '\\') i++;
    else if (ch === '"') inString = false;
    continue;
  }
  if (ch === '"') inString = true;
  else if (ch === '{') {
    if (depth === 0) start = i;
    depth++;
  } else if (ch === '}') {
    depth--;
    if (depth === 0) events.push(JSON.parse(text.slice(start, i + 1)));
  }
}
const rows = events.map((e) => {
  const url = e.event?.request?.url;
  const what = url
    ? `${e.event.request.method} ${new URL(url).pathname}`
    : (e.entrypoint ?? e.event?.type ?? Object.keys(e.event ?? {}).join(',') ?? '?');
  return { what, cpu: e.cpuTime ?? null, wall: e.wallTime ?? null, outcome: e.outcome, script: e.scriptName };
});
console.log(`events: ${rows.length}; fields on first: ${Object.keys(events[0] ?? {}).join(', ')}`);
for (const r of rows)
  console.log(
    `${String(r.cpu).padStart(4)} ms cpu  ${String(r.wall).padStart(5)} ms wall  ${r.outcome}  ${r.what}`,
  );
const cpus = rows.map((r) => r.cpu).filter((n) => typeof n === 'number');
if (cpus.length)
  console.log(
    `max cpu ${Math.max(...cpus)} ms over ${cpus.length} events; >10 ms: ${cpus.filter((n) => n > 10).length}`,
  );
