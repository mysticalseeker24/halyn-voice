// pnpm exec tsx scripts/clone-clips.ts [--render] [--upload] [--yes] [--ffmpeg=<path>] [--tenant=ten_aero] [--only=<id,…>]
//   [--lang=en-IN|hi-IN]
// Step 19: the AI clone's lines for scenario 3 (docs/DEMO_SCRIPT.md), in Saksham's own consented voice — Sarvam
// instant voice cloning, voice C (docs/DAY0.md check 8) — then ffmpeg atempo=1.25 (his pick) to MP3 in
// scripts/out/clips/. Clips are played from /stage/soundboard into the call from a second phone, each labelled
// "AI clone of Saksham's own voice". Storage: KV CONFIG `file:<tenant>:clip:<id>` with the line as metadata (ADR-023).
// Without flags it prints the plan and the cost. --render spends Sarvam credit and --upload writes to the deployed KV:
// both need --yes (Saksham's go-ahead in the session). ffmpeg: `npm i @ffmpeg-installer/ffmpeg` in a scratch folder
// (docs/HANDOFF.md convention 10) and pass its binary with --ffmpeg=, or set FFMPEG_PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ClipMetaSchema, type ClipMeta } from '../packages/shared/src/console';
import { repoRoot } from './lib/tidb';

/** Voice C, calm Hindi (hi-IN), cloned from Saksham's consented take 3 on 2026-10-27 (docs/DAY0.md check 8). */
export const VOICE_C = 'svc-90c91242-37e0-4581-ac86-c3def603b9aa';
const SARVAM_CLONE_URL = 'https://api.sarvam.ai/voices/clone';
/** Sarvam's price for cloned-voice synthesis (docs/DAY0.md): ₹2 per 1,000 characters. */
const RUPEES_PER_1000_CHARS = 2;
const TEMPO = 1.25;

export interface CloneClip extends ClipMeta {
  id: string;
}

// Scenario 3, the clone's side of the call to Aero (number A) from an unregistered second phone: a plain request for
// ₹45,000 to a new payee, account ending 4471, IFSC AERO0000001 (tests/scenarios/scenarios.yaml). Aero asks for a
// step-up, Halyn calls the real Saksham, he declines, and the clone gets nothing. English since 2026-10-29 (the Hindi
// lines are in git history). Names are written in Devanagari so the voice says them right (Sarvam reads Roman "Saksham"
// with a long "Saa").
export const CLIPS: readonly CloneClip[] = [
  { id: 'greet', order: 1, label: 'Greeting', text: 'Hi, this is सक्षम मिश्रा.' },
  {
    id: 'request',
    order: 2,
    label: 'The transfer',
    text: 'I need to send forty-five thousand rupees to a new account.',
  },
  {
    id: 'account',
    order: 3,
    label: 'Account ending',
    text: 'The account number ends in four, four, seven, one.',
  },
  { id: 'ifsc', order: 4, label: 'IFSC', text: 'The IFSC is A, E, R, O, then six zeros and one.' },
  { id: 'payee', order: 5, label: 'Payee name', text: "The payee's name is Rohan Verma." },
  { id: 'confirm', order: 6, label: 'Read-back: yes', text: "Yes, that's right, please send it." },
  { id: 'hold', order: 7, label: 'Waiting', text: "Okay, I'll hold." },
  { id: 'bye', order: 8, label: 'Goodbye', text: 'Okay, thanks.' },
].map((c) => ({ ...c, content_type: 'audio/mpeg' as const }));

/** Throws on a line the voice would mispronounce or that the KV metadata cannot hold. */
export function checkClip(clip: CloneClip): void {
  if (/saksham|suksham|sukshum/i.test(clip.text))
    throw new Error(`clip ${clip.id}: write the name in Devanagari (सक्षम मिश्रा), never in Roman script`);
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(clip.id)) throw new Error(`clip ${clip.id}: bad id`);
  const { id: _id, ...meta } = clip;
  ClipMetaSchema.parse(meta);
  if (new TextEncoder().encode(JSON.stringify(meta)).length > 1024)
    throw new Error(`clip ${clip.id}: metadata over KV's 1,024 bytes`);
}

export function costRupees(clips: readonly CloneClip[]): number {
  const chars = clips.reduce((n, c) => n + c.text.length, 0);
  return Math.round(((chars * RUPEES_PER_1000_CHARS) / 1000) * 100) / 100;
}

export interface CloneArgs {
  render: boolean;
  upload: boolean;
  yes: boolean;
  ffmpeg: string | null;
  tenant: string;
  only: string[] | null;
  /** Sarvam language_code for the render (voice C was cloned from a hi-IN take). */
  lang: 'en-IN' | 'hi-IN';
}

export function parseCloneArgs(argv: readonly string[]): CloneArgs {
  const args: CloneArgs = {
    render: false,
    upload: false,
    yes: false,
    ffmpeg: null,
    tenant: 'ten_aero',
    only: null,
    lang: 'en-IN',
  };
  for (const a of argv) {
    if (a === '--render') args.render = true;
    else if (a === '--upload') args.upload = true;
    else if (a === '--yes') args.yes = true;
    else if (a.startsWith('--ffmpeg=')) args.ffmpeg = a.slice('--ffmpeg='.length);
    else if (a.startsWith('--tenant=')) args.tenant = a.slice('--tenant='.length);
    else if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',').filter(Boolean);
    else if (a === '--lang=en-IN' || a === '--lang=hi-IN') args.lang = a.slice('--lang='.length) as CloneArgs['lang'];
    else throw new Error(`unknown option ${a}`);
  }
  if ((args.render || args.upload) && !args.yes)
    throw new Error(
      '--render spends Sarvam credit and --upload writes to the deployed KV: add --yes (go-ahead only)',
    );
  if (!/^ten_[a-z0-9_]{1,40}$/.test(args.tenant)) throw new Error(`bad tenant ${args.tenant}`);
  return args;
}

async function render(
  clip: CloneClip,
  key: string,
  ffmpeg: string,
  dir: string,
  lang: CloneArgs['lang'],
): Promise<string> {
  const form = new FormData();
  form.set('voice_id', VOICE_C);
  form.set('text', clip.text);
  form.set('language_code', lang);
  form.set('output_audio_codec', 'wav');
  form.set('speech_sample_rate', '24000');
  const res = await fetch(SARVAM_CLONE_URL, {
    method: 'POST',
    headers: { 'api-subscription-key': key },
    body: form,
  });
  const body = (await res.json().catch(() => null)) as { audio?: unknown; audio_b64?: unknown } | null;
  const b64 =
    typeof body?.audio === 'string'
      ? body.audio
      : typeof body?.audio_b64 === 'string'
        ? body.audio_b64
        : null;
  if (!res.ok || !b64) throw new Error(`Sarvam ${res.status} for clip ${clip.id}`);
  const wav = join(dir, `${clip.id}.wav`);
  const mp3 = join(dir, `${clip.id}.mp3`);
  writeFileSync(wav, Buffer.from(b64, 'base64'));
  const out = spawnSync(
    ffmpeg,
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      wav,
      '-filter:a',
      `atempo=${TEMPO}`,
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      mp3,
    ],
    { stdio: 'inherit' },
  );
  if (out.status !== 0) throw new Error(`ffmpeg failed for clip ${clip.id}`);
  return mp3;
}

/** KV namespace CONFIG's id, from apps/api/wrangler.toml (not a secret). */
function configNamespaceId(): string {
  const toml = readFileSync(join(repoRoot, 'apps', 'api', 'wrangler.toml'), 'utf8');
  const id = /binding = "CONFIG"\s*\nid = "([0-9a-f]{32})"/.exec(toml)?.[1];
  if (!id) throw new Error('no CONFIG KV namespace id in apps/api/wrangler.toml');
  return id;
}

/** Cloudflare's KV REST write with metadata (multipart value + metadata); no shell, no wrangler. */
async function upload(clip: CloneClip, file: string, tenant: string): Promise<void> {
  const { id, ...meta } = clip;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account)
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set (.env)');
  const key = encodeURIComponent(`file:${tenant}:clip:${id}`);
  const form = new FormData();
  form.set('value', new Blob([readFileSync(file)], { type: clip.content_type }));
  form.set('metadata', JSON.stringify(meta));
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${configNamespaceId()}/values/${key}`,
    { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: form },
  );
  if (!res.ok) throw new Error(`KV put failed for clip ${id} (${res.status})`);
}

async function main(argv: string[]): Promise<void> {
  const args = parseCloneArgs(argv);
  const clips = args.only ? CLIPS.filter((c) => args.only?.includes(c.id)) : CLIPS;
  for (const c of clips) checkClip(c);
  console.log(
    `${clips.length} clip(s), ${clips.reduce((n, c) => n + c.text.length, 0)} chars, ≈ ₹${costRupees(clips)} on Sarvam`,
  );
  for (const c of clips) console.log(`  ${c.order} ${c.id.padEnd(8)} ${c.text}`);
  if (!args.render && !args.upload) return console.log('dry run: add --render and/or --upload with --yes');

  const dir = join(repoRoot, 'scripts', 'out', 'clips');
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(repoRoot, '.env'))) process.loadEnvFile(join(repoRoot, '.env'));
  if (args.render) {
    const key = process.env.SARVAM_API_KEY;
    const ffmpeg = args.ffmpeg ?? process.env.FFMPEG_PATH ?? null;
    if (!key) throw new Error('SARVAM_API_KEY is not set (.env)');
    if (!ffmpeg || !existsSync(ffmpeg))
      throw new Error('pass --ffmpeg=<path to the ffmpeg binary> or set FFMPEG_PATH');
    for (const c of clips) console.log(`✓ rendered ${await render(c, key, ffmpeg, dir, args.lang)}`);
  }
  if (args.upload) {
    for (const c of clips) {
      const file = join(dir, `${c.id}.mp3`);
      if (!existsSync(file)) throw new Error(`no ${c.id}.mp3: render it first`);
      await upload(c, file, args.tenant);
      console.log(`✓ KV file:${args.tenant}:clip:${c.id}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`clone-clips failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
