import type { ReactNode } from 'react';
import { AeroShell } from '@/components/aero/aero-shell';

// Aero Bank: its own brand and a phone layout (max-width 420 px). Never mix with Halyn styles.
export default function AeroLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[420px] bg-sky-50 text-slate-900">
      <AeroShell>{children}</AeroShell>
    </div>
  );
}
