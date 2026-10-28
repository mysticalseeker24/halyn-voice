import type { ReactNode } from 'react';

// Halyn Stage: dark, fixed 1920×1080, never scrolls during a scenario (docs/UI.md).
export default function StageLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="dark bg-background text-foreground h-screen overflow-hidden">{children}</div>;
}
