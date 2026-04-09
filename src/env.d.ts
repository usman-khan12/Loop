/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

// CSS module declarations
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
