'use client';

import Link from 'next/link';
import { ConsoleShell } from '@/components/console/console-shell';

export default function ConsolePage() {
  return (
    <ConsoleShell title="Overview">
      {() => (
        <p className="text-slate-600">
          Live, Calls, Policies, Passes, Signals, Ledger and Integrations arrive in Step 13. Holds waiting for
          a specialist are in{' '}
          <Link href="/console/handoffs" className="text-indigo-700 underline">
            Handoffs
          </Link>
          .
        </p>
      )}
    </ConsoleShell>
  );
}
