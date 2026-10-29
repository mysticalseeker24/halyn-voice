import {
  ClipAudioResponseSchema,
  ClipIdSchema,
  ClipListResponseSchema,
  ClipMetaSchema,
  HalynError,
} from '@halyn/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../http/app-env';
import { consoleTenant } from './console';

// The Stage soundboard (Step 19): the AI clone's clips, rendered by scripts/clone-clips.ts and stored in KV under
// `file:<tenant>:clip:<id>` with their line as KV metadata (ADR-023). Console sessions only; read-only.

export const clipKey = (tenant: string, id: string) => `file:${tenant}:clip:${id}`;

/** GET /web/clips → the clips in scene order (keys whose metadata does not parse are skipped). */
export async function listClips(c: Context<AppEnv>) {
  const tenant = consoleTenant(c);
  const prefix = clipKey(tenant, '');
  const listed = await c.env.CONFIG.list({ prefix, limit: 50 });
  const clips = listed.keys.flatMap((key) => {
    const id = ClipIdSchema.safeParse(key.name.slice(prefix.length));
    const meta = ClipMetaSchema.safeParse(key.metadata);
    return id.success && meta.success ? [{ id: id.data, ...meta.data }] : [];
  });
  clips.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return c.json(ClipListResponseSchema.parse({ clips }));
}

/** GET /web/clips/:id → the audio as base64 (the typed client reads JSON only; a clip is ~50–150 kB). */
export async function clipAudio(c: Context<AppEnv>) {
  const tenant = consoleTenant(c);
  const id = ClipIdSchema.safeParse(c.req.param('id'));
  if (!id.success) throw new HalynError('E_NOT_FOUND', 'No such clip');
  const { value, metadata } = await c.env.CONFIG.getWithMetadata(clipKey(tenant, id.data), 'arrayBuffer');
  const meta = ClipMetaSchema.safeParse(metadata);
  if (!value || !meta.success) throw new HalynError('E_NOT_FOUND', 'No such clip');
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return c.json(
    ClipAudioResponseSchema.parse({
      id: id.data,
      content_type: meta.data.content_type,
      audio_b64: btoa(binary),
    }),
  );
}
