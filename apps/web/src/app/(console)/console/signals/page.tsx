'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { SignalsView } from '@/components/console/views';

export default function Page() {
  return <ConsoleShell title="Signals">{(api) => <SignalsView api={api} />}</ConsoleShell>;
}
