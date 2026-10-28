// Shared plumbing for the Bolna REST helpers (docs/BOLNA.md "Tools available"). Used where the Bolna MCP lacks a
// capability: graph agents, event injection, web-call sessions. Pure parts are exported for tests/tooling.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type JsonValue, maskDeep, maskNumbers } from '@halyn/shared';

export const BOLNA_BASE = 'https://api.bolna.ai';
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Load the repo's .env into process.env once (never printed). Values already set in the environment win. */
export function loadEnv(): void {
  const file = join(repoRoot, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set (.env)`);
  return value;
}

export interface Args {
  positional: string[];
  flags: Set<string>;
  options: Map<string, string>;
}

/** `--yes`, `--dry-run` become flags; `--key=value` becomes an option; everything else is positional. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { positional: [], flags: new Set(), options: new Map() };
  for (const arg of argv) {
    if (!arg.startsWith('--')) args.positional.push(arg);
    else if (arg.includes('=')) {
      const [key = '', ...rest] = arg.slice(2).split('=');
      args.options.set(key, rest.join('='));
    } else args.flags.add(arg.slice(2));
  }
  return args;
}

/** Writes need an explicit `--yes` (Saksham's go-ahead is recorded in the session, not assumed by the script). */
export function requireYes(args: Args, what: string): void {
  if (!args.flags.has('yes') && !args.flags.has('dry-run'))
    throw new Error(
      `${what} changes Bolna state or spends credit: re-run with --yes (or --dry-run to preview)`,
    );
}

const BOLNA_KEY = /\bbn-[0-9a-f]{20,}\b/g;

/** Phone numbers to last 4 and any Bolna key removed, at any depth. Safe to print. */
export function redact(value: unknown): unknown {
  const masked = maskDeep(JSON.parse(JSON.stringify(value ?? null)) as JsonValue);
  return JSON.parse(JSON.stringify(masked).replace(BOLNA_KEY, 'bn-[redacted]')) as unknown;
}

export function redactText(text: string): string {
  return maskNumbers(text).replace(BOLNA_KEY, 'bn-[redacted]');
}

/** Push-time placeholders: only these UPPER_CASE names are substituted (Bolna's own `{{lower_case}}` vars stay). */
export const PUSH_PLACEHOLDERS = ['API_URL', 'PROBE_URL', 'HALYN_TOOL_SECRET', 'SPECIALIST_NUMBER'] as const;
export type PushPlaceholder = (typeof PUSH_PLACEHOLDERS)[number];

export function substitutePlaceholders(
  text: string,
  values: Partial<Record<PushPlaceholder, string>>,
): string {
  let out = text;
  for (const name of PUSH_PLACEHOLDERS) {
    const value = values[name];
    if (value !== undefined) out = out.replaceAll(`{{${name}}}`, value);
  }
  const left = out.match(/\{\{[A-Z][A-Z0-9_]*\}\}/g);
  if (left) throw new Error(`unresolved push-time placeholders: ${[...new Set(left)].join(', ')}`);
  return out;
}

/** The secrets that appear in an agent config, replaced so a snapshot can be committed. */
export function stripSecrets(value: unknown, secrets: readonly string[]): unknown {
  let text = JSON.stringify(value ?? null);
  for (const secret of secrets) if (secret.length >= 8) text = text.replaceAll(secret, '[secret]');
  text = text.replace(/"api_token"\s*:\s*"[^"]*"/g, '"api_token":"[secret]"');
  text = text.replace(/"x-halyn-secret"\s*:\s*"[^"]*"/g, '"x-halyn-secret":"[secret]"');
  return redact(JSON.parse(text));
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  dryRun?: boolean;
}

/** One Bolna REST call. Non-2xx throws with the (redacted) detail; `dryRun` prints the request without the key. */
export async function bolna<T = unknown>(opts: RequestOptions): Promise<T | null> {
  const url = `${BOLNA_BASE}${opts.path}`;
  if (opts.dryRun) {
    console.log(
      JSON.stringify({ dry_run: true, method: opts.method, url, body: redact(opts.body) }, null, 2),
    );
    return null;
  }
  const res = await fetch(url, {
    method: opts.method,
    headers: { Authorization: `Bearer ${env('BOLNA_API_KEY')}`, 'Content-Type': 'application/json' },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep the text
  }
  if (!res.ok)
    throw new Error(
      `${opts.method} ${opts.path} → ${res.status}: ${redactText(JSON.stringify(data)).slice(0, 600)}`,
    );
  return data as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the file is executed directly (so tests can import the pure parts without running the CLI). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(entry).href;
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    loadEnv();
    await main();
  } catch (err) {
    console.error(redactText(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
}
