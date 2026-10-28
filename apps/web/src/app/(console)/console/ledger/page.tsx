'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { LedgerView } from '@/components/console/views';

export default function Page() {
  return <ConsoleShell title="Ledger">{(api) => <LedgerView api={api} />}</ConsoleShell>;
}
