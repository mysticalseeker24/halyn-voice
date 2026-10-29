import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { MotionRoot } from '@/components/motion-root';
import { THEME_SCRIPT } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';
import './globals.css';

// docs/UI.md: Inter for text, JetBrains Mono for labels, ids and hashes.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  metadataBase: new URL('https://halyn-voice.vercel.app'),
  title: 'Halyn — the permission layer for voice agents',
  description:
    "A voice agent proposes; Halyn decides and executes. Don't trust the voice. Trust the permission.",
  openGraph: {
    title: 'Halyn — the permission layer for voice agents',
    description: "Don't trust the voice. Trust the permission.",
    url: '/',
    siteName: 'Halyn',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: "Halyn: Don't trust the voice. Trust the permission.",
      },
    ],
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn('font-sans', sans.variable, mono.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
