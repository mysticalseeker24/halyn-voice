// pnpm compile:packs — validate policy-packs/*.yaml and write normalised JSON to policy-packs/compiled/.
// The Worker never parses YAML: it loads these JSON packs (from KV) and Zod-parses them with
// CompiledPolicyPackSchema. Output is reproducible: no timestamps, actions sorted, source_sha = SHA-256(YAML).
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePolicyPack, validatePolicyPack } from '@halyn/shared';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = join(root, 'policy-packs');
const outDir = join(sourceDir, 'compiled');

const files = (await readdir(sourceDir)).filter((f) => f.endsWith('.yaml')).sort();
if (files.length === 0) {
  console.error('compile:packs: no policy-packs/*.yaml found');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
let failed = false;

for (const file of files) {
  const bytes = await readFile(join(sourceDir, file));
  let data: unknown;
  try {
    data = parse(bytes.toString('utf8'), { prettyErrors: true });
  } catch (err) {
    console.error(`✗ policy-packs/${file}: invalid YAML\n${String(err)}`);
    failed = true;
    continue;
  }

  const result = validatePolicyPack(data);
  if (!result.ok) {
    console.error(`✗ policy-packs/${file}\n${result.error}`);
    failed = true;
    continue;
  }
  if (`${result.pack.pack}.yaml` !== file) {
    console.error(`✗ policy-packs/${file}: pack id "${result.pack.pack}" must match the file name`);
    failed = true;
    continue;
  }

  const sha = createHash('sha256').update(bytes).digest('hex');
  const compiled = compilePolicyPack(result.pack, sha);
  const outFile = join(outDir, `${compiled.pack}.json`);
  await writeFile(outFile, `${JSON.stringify(compiled, null, 2)}\n`);
  const count = Object.keys(compiled.actions).length;
  console.log(
    `✓ policy-packs/${file} → policy-packs/compiled/${compiled.pack}.json (${count} actions, sha ${sha.slice(0, 12)})`,
  );
}

if (failed) process.exit(1);
