/**
 * Shared E2E hermeticity helper (#2014): intercept external font CDN requests
 * so no Playwright spec ever reaches fonts.googleapis.com / fonts.gstatic.com.
 *
 * Both app/web/index.html and app/desktop/index.html load Google Fonts via
 * render-blocking <link> tags (Material Symbols on both surfaces, plus Hanken
 * Grotesk on web). Without interception those requests hit the real network,
 * which makes specs flaky on restricted networks and breaks the "zero
 * production/external requests" hermetic goal.
 *
 * Entry points:
 *
 * - fulfillExternalFontIfMatch(route): for specs that already own a catch-all
 *   route handler (web stubbed-hub suite). Call it where the
 *   inline font branch used to be; it fulfills font requests and returns
 *   true, otherwise changes nothing and returns false.
 *
 * - blockExternalFonts(page): for specs without a font-aware catch-all
 *   (desktop smoke / oidc-login / geometry / chat-flow / teamrun). Register
 *   it AFTER every other page.route() call in the test: Playwright matches
 *   routes last-registered-first, so the guard sees every request first,
 *   fulfills font hosts, and hands everything else back to the previously
 *   registered handlers via route.fallback() (or to the network when no
 *   handler remains).
 *
 * - assertFontGuardHermetic(guard): leak assertions for specs without the
 *   data-mode contract (smoke / oidc-login / geometry) — no font request and
 *   no request to a forbidden boundary may have passed the guard.
 *
 * Font requests are fulfilled with an empty stylesheet instead of aborted:
 * that is the behavior the web stubbed-hub specs proved keeps the document
 * load event firing for the render-blocking <link> tags.
 */
import { expect, type Page, type Route } from '@playwright/test';
import {
  classifyE2ERequest,
  type E2EObservedRequest,
  type E2ERequestBoundary,
} from '../shared/src/testing/e2eDataModeContract';

/** External font CDN hosts loaded by index.html <link> tags. */
export const E2E_EXTERNAL_FONT_HOSTS: ReadonlySet<string> = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

/**
 * Request boundaries that count as production/live-stack hits in hermetic
 * assertions. local-edge is not included: it is a localhost probe, not a
 * production host.
 */
export const E2E_PRODUCTION_BOUNDARIES: ReadonlySet<E2ERequestBoundary> = new Set([
  'hub',
  'tokendance-id',
  'gateway',
]);

/** Font requests intercepted by the page-level guard, fulfilled in place. */
export interface E2EFontGuard {
  fontRequests: E2EObservedRequest[];
  /** Non-font requests the guard delegated via route.fallback(). */
  passthroughRequests: E2EObservedRequest[];
}

export interface BlockExternalFontsOptions {
  /**
   * Record every non-font request the guard falls back on, so specs without
   * their own request log can still assert "no production host hits".
   */
  recordPassthrough: boolean;
}

export interface FontGuardHermeticOptions {
  /**
   * Boundaries that must never appear among passthrough requests. Defaults
   * to E2E_PRODUCTION_BOUNDARIES; narrow it when a downstream catch-all
   * already refuses some boundaries (e.g. geometry-smoke 503s hub hosts).
   */
  forbiddenBoundaries: ReadonlySet<string>;
}

export function isExternalFontUrl(value: string | URL): boolean {
  let url: URL;
  if (value instanceof URL) {
    url = value;
  } else {
    try {
      url = new URL(value);
    } catch {
      return false;
    }
  }
  return E2E_EXTERNAL_FONT_HOSTS.has(url.host);
}

/**
 * Route-level helper for catch-all handlers: if the request targets an
 * external font host, fulfill it with an empty stylesheet and return true.
 * Otherwise return false and leave the route untouched.
 */
export async function fulfillExternalFontIfMatch(route: Route): Promise<boolean> {
  if (!isExternalFontUrl(route.request().url())) {
    return false;
  }
  await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  return true;
}

/**
 * Page-level guard. Register AFTER all other routes of the test so it is
 * matched first; non-font requests are delegated via route.fallback().
 */
export async function blockExternalFonts(
  page: Page,
  options?: BlockExternalFontsOptions,
): Promise<E2EFontGuard> {
  const recordPassthrough = options?.recordPassthrough ?? false;
  const guard: E2EFontGuard = { fontRequests: [], passthroughRequests: [] };

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (isExternalFontUrl(request.url())) {
      guard.fontRequests.push({ method: request.method(), url: request.url() });
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return;
    }
    if (recordPassthrough) {
      guard.passthroughRequests.push({ method: request.method(), url: request.url() });
    }
    await route.fallback();
  });

  return guard;
}

/**
 * Fail-closed leak assertions for guard-based specs: no external font request
 * and no request to a forbidden boundary may have passed the guard.
 */
export function assertFontGuardHermetic(
  guard: E2EFontGuard,
  options?: FontGuardHermeticOptions,
): void {
  const forbidden = options?.forbiddenBoundaries ?? E2E_PRODUCTION_BOUNDARIES;

  const fontLeaks = guard.passthroughRequests.filter((request) => isExternalFontUrl(request.url));
  expect(
    fontLeaks,
    'external font requests must be intercepted before reaching the network (#2014)',
  ).toHaveLength(0);

  const forbiddenHits = guard.passthroughRequests.filter((request) =>
    forbidden.has(classifyE2ERequest(request.url)),
  );
  expect(
    forbiddenHits,
    `forbidden request boundaries must never be hit (#2014): ${forbiddenHits
      .map((request) => `${request.method} ${request.url}`)
      .join(', ')}`,
  ).toHaveLength(0);
}
