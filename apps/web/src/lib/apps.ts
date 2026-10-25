// The four apps in this Next.js project (docs/UI.md), one route group each.
export interface AppEntry {
  href: '/stage' | '/console' | '/aero' | '/assistant';
  name: string;
  audience: string;
}

export const APPS: readonly AppEntry[] = [
  { href: '/stage', name: 'Halyn Stage', audience: 'Demo video and judges' },
  { href: '/console', name: 'Halyn Console', audience: 'Bank teams' },
  { href: '/aero', name: 'Aero Bank', audience: 'The customer, on their phone' },
  { href: '/assistant', name: "Saksham's Assistant", audience: "The customer's AI assistant" },
];
