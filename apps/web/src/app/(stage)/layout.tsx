import type { ReactNode } from 'react';

// Halyn Stage: dark, fixed 1920×1080, never scrolls during a scenario (docs/UI.md). Built in Step 9.
export default function StageLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="dark bg-background text-foreground min-h-screen">{children}</div>;
}
