import type { ReactNode } from 'react';

// Saksham's Assistant: minimal chat; the Pass card is the shareable element.
export default function AssistantLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="bg-background text-foreground mx-auto min-h-screen max-w-3xl">{children}</div>;
}
