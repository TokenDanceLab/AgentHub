declare module 'dompurify' {
  interface Config {
    ALLOWED_TAGS?: string[];
    ALLOWED_ATTR?: string[];
    ADD_TAGS?: string[];
    ADD_ATTR?: string[];
    FORBID_TAGS?: string[];
    FORBID_ATTR?: string[];
    USE_PROFILES?: Record<string, boolean>;
    ALLOW_ARIA_ATTR?: boolean;
    ALLOW_DATA_ATTR?: boolean;
    ALLOW_UNKNOWN_PROTOCOLS?: boolean;
    SAFE_FOR_TEMPLATES?: boolean;
    WHOLE_DOCUMENT?: boolean;
    RETURN_DOM?: boolean;
    RETURN_DOM_FRAGMENT?: boolean;
    RETURN_DOM_IMPORT?: boolean;
    SANITIZE_DOM?: boolean;
    KEEP_CONTENT?: boolean;
    IN_PLACE?: boolean;
    ALLOWED_URI_REGEXP?: RegExp;
    NAMESPACE?: string;
    [key: string]: unknown;
  }

  type HookName =
    | 'beforeSanitizeElements'
    | 'uponSanitizeElement'
    | 'afterSanitizeElements'
    | 'beforeSanitizeAttributes'
    | 'uponSanitizeAttribute'
    | 'afterSanitizeAttributes'
    | 'beforeSanitizeShadowDOM'
    | 'uponSanitizeShadowNode'
    | 'afterSanitizeShadowDOM';

  const DOMPurify: {
    sanitize(dirty: string, config?: Config): string;
    sanitize(dirty: Node, config?: Config): Node;
    addHook(hook: HookName, callback: (node: Element, data: Record<string, unknown>) => void): void;
    removeHook(hook: HookName): void;
    removeHooks(hook: HookName): void;
    removeAllHooks(): void;
    isValidAttribute(tag: string, attr: string, value: string): boolean;
    setConfig(config: Config): void;
    clearConfig(): void;
    version: string;
    removed: unknown[];
  };

  export type { Config };
  export default DOMPurify;
}
