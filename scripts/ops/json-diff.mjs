// Semantic diff of a JSON file against its HEAD version: changed leaf paths only (values cut to 90 chars).
// Usage (repo root): node scripts/ops/json-diff.mjs <file>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const before = JSON.parse(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }));
const after = JSON.parse(readFileSync(file, 'utf8'));
const flat = (o, p = '', out = new Map()) => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flat(v, `${p}.${k}`, out);
  else out.set(p, o);
  return out;
};
const a = flat(before);
const b = flat(after);
const cut = (v) => JSON.stringify(v)?.slice(0, 90);
for (const [k, v] of b) if (a.get(k) !== v) console.log(`${a.has(k) ? '~' : '+'} ${k} = ${cut(v)}`);
for (const k of a.keys()) if (!b.has(k)) console.log(`- ${k}`);
