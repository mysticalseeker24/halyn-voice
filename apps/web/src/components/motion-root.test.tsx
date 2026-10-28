import { render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'framer-motion';
import { useContext } from 'react';
import { describe, expect, it } from 'vitest';
import { ENTER, MotionRoot } from './motion-root';

function ReducedMotionProbe() {
  const { reducedMotion } = useContext(MotionConfigContext);
  return <p>{reducedMotion}</p>;
}

describe('MotionRoot', () => {
  it("honours the viewer's prefers-reduced-motion setting", () => {
    render(
      <MotionRoot>
        <ReducedMotionProbe />
      </MotionRoot>,
    );
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('keeps the shared entrance under 300 ms and never fully transparent (docs/UI.md)', () => {
    expect(ENTER.transition.duration).toBeLessThan(0.3);
    expect(ENTER.initial.opacity).toBeGreaterThan(0);
  });
});
