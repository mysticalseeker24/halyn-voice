// Timeline of a Bolna raw-log dump: transcripts (with STT latency), routing transitions, tool calls, synthesizer
// requests. Numbers masked; URLs' ?key= dropped. Usage: node scripts/ops/call-timeline.mjs <raw-log file>
import { readFileSync } from 'node:fs';

const text = readFileSync(process.argv[2], 'utf8');
const json = JSON.parse(text.slice(text.indexOf('{')));
const mask = (s) =>
  String(s)
    .replace(/\+?\d{10,13}/g, (m) => `••••${m.slice(-4)}`)
    .replace(/key=[A-Za-z0-9_-]+/g, 'key=***');
const rows = json.data ?? [];
const t0 = Date.parse(`${rows[0]?.created_at.replace(' ', 'T')}Z`);
const at = (r) =>
  ((Date.parse(`${r.created_at.replace(' ', 'T')}${r.created_at.endsWith('Z') ? '' : 'Z'}`) - t0) / 1000)
    .toFixed(1)
    .padStart(5);
for (const r of rows) {
  const d = typeof r.data === 'string' ? r.data : '';
  if (r.component === 'transcriber' && r.type === 'response')
    console.log(`${at(r)} heard  ${mask(d).slice(0, 50)}  (stt ${Number(r.latency ?? 0).toFixed(2)} s)`);
  else if (r.component === 'synthesizer' && r.type === 'request')
    console.log(`${at(r)} said   ${mask(d).slice(0, 60)}`);
  else if (r.component === 'graph_routing' && r.type === 'response' && /→|event:/.test(d))
    console.log(`${at(r)} route  ${d.split('|').slice(0, 3).join('|').slice(0, 90)}`);
  else if (r.component === 'function_call' || /warning|error/.test(r.component))
    console.log(
      `${at(r)} ${r.component.slice(0, 6)} ${(r.tool_name ?? '').padEnd(22)} ${mask(d).slice(0, 70)}`,
    );
}
