'use client';

import { useParams } from 'next/navigation';
import { ConsoleShell } from '@/components/console/console-shell';
import { CallDetailView } from '@/components/console/views';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <ConsoleShell title="Call">{(api) => <CallDetailView api={api} runId={decodeURIComponent(id)} />}</ConsoleShell>
  );
}
