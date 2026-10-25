import Link from 'next/link';
import { APPS } from '@/lib/apps';

export function AppNav() {
  return (
    <nav aria-label="Apps">
      <ul className="grid gap-3 sm:grid-cols-2">
        {APPS.map((app) => (
          <li key={app.href}>
            <Link href={app.href} className="hover:bg-accent block rounded-lg border p-4 transition-colors">
              <span className="block font-medium">{app.name}</span>
              <span className="text-muted-foreground block text-sm">{app.audience}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
