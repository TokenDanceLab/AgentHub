/**
 * Shared jsdom polyfills for the virtualized Transcript (virtua).
 *
 * jsdom has no layout engine: `ResizeObserver` never fires and
 * `Element.scrollIntoView` is unimplemented. virtua mounts a ResizeObserver
 * per visible row and on the scroll container, and the Transcript highlight
 * effect calls scrollIntoView on the target row. This helper was previously
 * copy-pasted into every package's test setup (#1678 test-system
 * convergence); it now lives in shared and is installed by
 * shared/web/desktop setup files.
 *
 * Safe in node-env suites (e.g. desktop edge-integration config): the
 * `typeof` guards skip both stubs when the globals are absent or already
 * provided.
 */
export function installJsdomPolyfills(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  }
}
