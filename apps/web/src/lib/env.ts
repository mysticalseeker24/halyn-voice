// The API base URL is public (it is a URL, not a secret). The Bolna key never reaches the browser.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/+$/, '');

/** `https://x` becomes `wss://x/ws`, `http://x` becomes `ws://x/ws`. */
export function wsUrl(apiUrl: string = API_URL): string {
  return apiUrl.replace(/^http/, 'ws') + '/ws';
}
