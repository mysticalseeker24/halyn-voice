// Vite `?raw` imports (test-time only; the Worker never reads YAML at runtime).
declare module '*?raw' {
  const content: string;
  export default content;
}
