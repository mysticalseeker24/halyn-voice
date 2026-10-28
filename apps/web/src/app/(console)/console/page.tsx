'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { LiveView } from '@/components/console/live-view';

export default function Page() {
  return <ConsoleShell title="Live">{(api, token) => <LiveView api={api} token={token} />}</ConsoleShell>;
}
