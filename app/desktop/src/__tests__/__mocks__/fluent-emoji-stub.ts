// Stub for @lobehub/fluent-emoji — the real package uses ESM directory imports
// that Node.js cannot resolve. This stub prevents vitest from ever loading
// the real package, sidestepping the error entirely.
export const FluentEmoji = () => null;
export const getEmoji = () => undefined;
export const getEmojiNameByCharacter = () => undefined;
export const getFluentEmojiCDN = () => '';
export default () => null;
