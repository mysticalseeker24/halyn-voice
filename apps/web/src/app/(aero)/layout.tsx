import type { ReactNode } from 'react';
import { AeroShell } from '@/components/aero/aero-shell';

// Aero Bank: its own brand (the `.aero` token scope, light and dark) and a phone layout (max-width 420 px). Never mix
// with Halyn styles.
export default function AeroLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="aero bg-background text-foreground min-h-screen">
      <div className="mx-auto min-h-screen w-full max-w-[420px]">
        <AeroShell>{children}</AeroShell>
      </div>
    </div>
  );
}
