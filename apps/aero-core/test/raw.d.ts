// Vite `?raw` imports (test-time only): lets a test compare the committed seed/seed.sql with the generated one.
declare module '*?raw' {
  const content: string;
  export default content;
}
