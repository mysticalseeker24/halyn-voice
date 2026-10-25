import type { ReactNode } from 'react';

// Halyn Console for bank teams: Live, Calls, Policies, Passes, Test, Signals, Ledger, Handoffs, Integrations.
export default function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="bg-background text-foreground min-h-screen">{children}</div>;
}
