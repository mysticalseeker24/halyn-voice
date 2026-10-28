'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { PassesView } from '@/components/console/views';

export default function Page() {
  return <ConsoleShell title="Passes">{(api) => <PassesView api={api} />}</ConsoleShell>;
}
