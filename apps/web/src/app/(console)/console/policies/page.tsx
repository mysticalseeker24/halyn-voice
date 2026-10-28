'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { PoliciesView } from '@/components/console/views';

export default function Page() {
  return <ConsoleShell title="Policies">{(api) => <PoliciesView api={api} />}</ConsoleShell>;
}
