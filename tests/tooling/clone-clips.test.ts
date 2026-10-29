import { describe, expect, it } from 'vitest';
import { CLIPS, checkClip, costRupees, parseCloneArgs } from '../../scripts/clone-clips';

// Step 19: the clone's lines (scenario 3) and the script's guards.

describe('clone-clips', () => {
  it('every line passes: Devanagari name, valid KV metadata, scene order 1..n', () => {
    for (const clip of CLIPS) expect(() => checkClip(clip)).not.toThrow();
    expect(CLIPS.map((c) => c.order)).toEqual(CLIPS.map((_, i) => i + 1));
    expect(CLIPS.some((c) => c.text.includes('सक्षम मिश्रा'))).toBe(true);
  });

  it('refuses the name in Roman script', () => {
    const roman = { ...CLIPS[0]!, text: 'Hi, I am Saksham' };
    expect(() => checkClip(roman)).toThrow(/Devanagari/);
  });

  it('renders and uploads only with --yes; costs a few rupees', () => {
    expect(parseCloneArgs([])).toMatchObject({ render: false, upload: false });
    expect(() => parseCloneArgs(['--render'])).toThrow(/--yes/);
    expect(() => parseCloneArgs(['--upload'])).toThrow(/--yes/);
    expect(parseCloneArgs(['--render', '--upload', '--yes', '--only=greet,bye'])).toMatchObject({
      render: true,
      upload: true,
      only: ['greet', 'bye'],
    });
    expect(() => parseCloneArgs(['--tenant=../x'])).toThrow(/tenant/);
    expect(costRupees(CLIPS)).toBeLessThan(2);
  });
});
