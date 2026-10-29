// Halyn's mark: an "H" whose crossbar is a gate — the one place every action must pass. currentColor, so it follows
// the theme. Replace with the final logo file when it exists (public/halyn-mark.svg).
export function HalynMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <rect x="3" y="3" width="4.5" height="18" rx="1" fill="currentColor" />
      <rect x="16.5" y="3" width="4.5" height="18" rx="1" fill="currentColor" />
      <rect x="9" y="10.25" width="6" height="3.5" rx="0.75" fill="var(--signal)" />
    </svg>
  );
}
