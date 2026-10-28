'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { TestView } from '@/components/console/test-view';

export default function Page() {
  return (
    <ConsoleShell title="Halyn Test">{(api, token) => <TestView api={api} token={token} />}</ConsoleShell>
  );
}
