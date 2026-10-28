'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { IntegrationsView } from '@/components/console/views';

export default function Page() {
  return <ConsoleShell title="Integrations">{(api) => <IntegrationsView api={api} />}</ConsoleShell>;
}
