// Sets KEY=value lines in .env (replacing an existing KEY= line or appending), printing names only.
// Usage (repo root): node scripts/ops/set-env.mjs KEY=value [KEY=value …]
import { readFileSync, writeFileSync } from 'node:fs';

let text = readFileSync('.env', 'utf8');
for (const pair of process.argv.slice(2)) {
  const i = pair.indexOf('=');
  const key = pair.slice(0, i);
  const value = pair.slice(i + 1);
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`bad key ${key}`);
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (line.test(text)) text = text.replace(line, `${key}=${value}`);
  else text = `${text.replace(/\n?$/, '\n')}${key}=${value}\n`;
  console.log(`set ${key}`);
}
writeFileSync('.env', text);
