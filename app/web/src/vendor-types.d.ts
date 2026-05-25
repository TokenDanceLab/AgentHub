// Type declarations for modules without bundled types
declare module 'react-syntax-highlighter' {
  export const Prism: any;
  export default Prism;
}

declare module 'react-syntax-highlighter/dist/esm/prism-light' {
  const SyntaxHighlighter: any;
  export default SyntaxHighlighter;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const oneDark: { [key: string]: React.CSSProperties };
  export const oneLight: { [key: string]: React.CSSProperties };
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/tsx' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/typescript' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/javascript' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/bash' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/json' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/css' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/python' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/markdown' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/diff' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/yaml' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/rust' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/go' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/java' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/kotlin' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/swift' {
  const lang: any;
  export default lang;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/sql' {
  const lang: any;
  export default lang;
}

declare module '@lobehub/icons' {
  export const ModelIcon: React.ComponentType<{ model: string; size?: number }>;
  export const ClaudeCode: React.ComponentType<{ size?: number }>;
  export const Codex: React.ComponentType<{ size?: number }>;
  export const OpenCode: React.ComponentType<{ size?: number }>;
}
