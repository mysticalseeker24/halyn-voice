import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './globals.css';

// docs/UI.md: Inter for text, JetBrains Mono for ids and hashes.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Halyn',
  description: "The permission layer for voice agents. Don't trust the voice. Trust the permission.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn('font-sans', sans.variable, mono.variable)}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
