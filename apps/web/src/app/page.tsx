import { AppNav } from '@/components/app-nav';

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Halyn</h1>
        <p className="text-muted-foreground mt-2">Don&apos;t trust the voice. Trust the permission.</p>
      </div>
      <AppNav />
    </main>
  );
}
