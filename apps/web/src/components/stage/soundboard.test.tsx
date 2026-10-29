import { type Clip, CLIP_DISCLOSURE } from '@halyn/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SoundboardView } from './soundboard';

const clip = (id: string, order: number, label: string): Clip => ({
  id,
  order,
  label,
  text: 'नमस्ते',
  content_type: 'audio/mpeg',
});
const CLIPS = [clip('greet', 1, 'Greeting'), clip('request', 2, 'Request'), clip('confirm', 3, 'Confirm')];

describe('Soundboard', () => {
  it('labels every clip as an AI clone of Saksham’s own voice', () => {
    render(
      <SoundboardView clips={CLIPS} playing={null} loadingId={null} onPlay={vi.fn()} onStop={vi.fn()} />,
    );
    const items = screen.getAllByTestId('clip');
    expect(items).toHaveLength(3);
    for (const item of items) expect(within(item).getByText(CLIP_DISCLOSURE)).toBeInTheDocument();
    expect(CLIP_DISCLOSURE).toBe("AI clone of Saksham's own voice");
  });

  it('plays a clip, and its button stops it while it plays', async () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <SoundboardView clips={CLIPS} playing={null} loadingId={null} onPlay={onPlay} onStop={onStop} />,
    );
    await userEvent.click(within(screen.getAllByTestId('clip')[1] as HTMLElement).getByRole('button'));
    expect(onPlay).toHaveBeenCalledWith(CLIPS[1]);
    rerender(
      <SoundboardView clips={CLIPS} playing="request" loadingId={null} onPlay={onPlay} onStop={onStop} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('says how to make clips when there are none', () => {
    render(<SoundboardView clips={[]} playing={null} loadingId={null} onPlay={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText(/No clips yet/)).toBeInTheDocument();
  });
});
