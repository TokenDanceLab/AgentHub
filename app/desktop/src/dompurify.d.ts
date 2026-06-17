declare module 'dompurify' {
  const DOMPurify: {
    sanitize(dirty: string, config?: Record<string, unknown>): string;
    addHook(hook: string, callback: (node: unknown) => unknown): void;
    setConfig(config: Record<string, unknown>): void;
  };
  export default DOMPurify;
}
