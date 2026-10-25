// Contract tests read the repo's own specs (docs, policy packs, scenarios). Test-only: src/ stays pure.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

export function readRepoYaml(relativePath: string): unknown {
  return parse(readRepoFile(relativePath));
}

export function policyPackFiles(): string[] {
  return readdirSync(join(repoRoot, 'policy-packs'))
    .filter((f) => f.endsWith('.yaml'))
    .sort();
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
