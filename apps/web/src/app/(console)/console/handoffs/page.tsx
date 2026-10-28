'use client';

import { ConsoleShell } from '@/components/console/console-shell';
import { HandoffsView } from '@/components/console/handoffs-view';

export default function HandoffsPage() {
  return <ConsoleShell title="Handoffs">{(api) => <HandoffsView api={api} />}</ConsoleShell>;
}
