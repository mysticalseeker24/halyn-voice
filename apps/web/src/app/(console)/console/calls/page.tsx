'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { CallsView } from '@/components/console/views';

export default function Page() {
  return <ConsoleShell title="Calls">{(api) => <CallsView api={api} />}</ConsoleShell>;
}
