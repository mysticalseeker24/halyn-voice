import type { ReactNode } from 'react';

// Aero Bank: its own brand and a phone layout (max-width 420 px). Never mix with Halyn styles.
export default function AeroLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="mx-auto min-h-screen w-full max-w-[420px] bg-white text-slate-900">{children}</div>;
}
