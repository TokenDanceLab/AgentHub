/* ═══════════════════════════════════════════════════════════════════════
   TEST I18N — shared test i18next instance factory (Issue #1717)

   Shared/Desktop/Web vitest setups each register ONE isolated test
   instance built by this factory. Components render through the real
   react-i18next `useTranslation` path (no per-file `vi.mock`), so the
   `NO_I18NEXT_INSTANCE` warning becomes a real failure signal again.

   Isolation contract:
   - `i18next.createInstance()` produces a fresh instance per call; nothing
     here touches the `i18next` module default or a cross-project singleton.
   - Each project's setup calls `installTestI18n()` once; the react-i18next
     module default (`setI18n` via initReactI18next) is scoped to whichever
     project copy resolves `react-i18next` (desktop/web alias their own
     node_modules copy, so registration cannot leak across projects).
   - Resources are re-used read-only from the production bundles:
     `shared/src/chatview/i18n/resources` + `shared/src/i18n` (workbench).
     Project-specific namespaces (web common/status/..., desktop locales)
     are passed in by the owning setup only when its suites assert real
     translated copy.
   ═══════════════════════════════════════════════════════════════════════ */

import i18next, { type InitOptions, type Resource } from 'i18next';
import { getI18n, initReactI18next } from 'react-i18next';

import { CHATVIEW_I18N_NAMESPACE, chatviewResources } from '../chatview/i18n/resources';
import { SHARED_WORKBENCH_I18N_NAMESPACE, sharedWorkbenchResources } from '../i18n';

/** Isolated i18next instance type (per-project, created via createInstance). */
type TestI18nInstance = ReturnType<typeof i18next.createInstance>;

/**
 * Default language for a project test instance.
 *
 * `'test'` deliberately matches no registered bundle. i18next then echoes
 * keys verbatim (`t('typing.dm')` -> `'typing.dm'`) and still honors
 * `t(key, defaultValue)` fallbacks — the exact visible behavior suites had
 * BEFORE any instance existed. Suites that were written against raw-key
 * echo (and are outside the #1717 frozen-file boundary, e.g.
 * TypingIndicator / ContactsPage) therefore keep passing unchanged, while
 * `useTranslation` now resolves a real instance so the
 * `NO_I18NEXT_INSTANCE` warning can no longer appear.
 */
export const TEST_I18N_DEFAULT_LNG = 'test';
/**
 * No fallback language: when a suite opts into zh/en via
 * `useTestI18nLanguage`, keys missing from that bundle keep echoing the key
 * (matching the removed per-file mocks' `resources[key] ?? key` semantics)
 * instead of silently falling through to the other language.
 */
export const TEST_I18N_FALLBACK_LNG = false;

/**
 * Switch the project test instance to `lng` (e.g. `'zh'` / `'en'`). Frozen
 * suites call this in `beforeAll` so their visible-copy assertions resolve
 * against the real resource bundle instead of the key-echo default.
 */
export function useTestI18nLanguage(lng: string): Promise<unknown> | undefined {
  return getI18n()?.changeLanguage(lng);
}

/** Per-language resource payload for one extra (project-owned) namespace. */
export interface TestNamespaceResources {
  zh: Record<string, unknown>;
  en: Record<string, unknown>;
}

/**
 * Flatten a nested resource tree into dot-separated keys, mirroring the
 * semantics of `flattenSharedWorkbenchResource` in the production i18n
 * module. Nested section keys (e.g. `contacts.empty`) stop shadowing
 * lookups: `t('contacts.empty', fallback)` resolves the fallback instead of
 * returning an object, which is how the production components intend it.
 */
function flattenResourceTree(tree: Record<string, unknown>, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flat[next] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flat, flattenResourceTree(value as Record<string, unknown>, next));
    }
  }
  return flat;
}

export interface TestI18nOptions {
  /** Resolved language for the instance. Defaults to TEST_I18N_DEFAULT_LNG
   *  ('test' — key-echo, matching pre-instance suite behavior). */
  lng?: string;
  /** Fallback language. Defaults to false (no fallback). */
  fallbackLng?: string | false;
  /** Default namespace for bare `useTranslation()` consumers. Defaults to
   *  'chatview' so shared components (which always pass an explicit ns)
   *  resolve; project setups can override (web: 'common'). */
  defaultNS?: string;
  /** Extra project-owned namespaces, merged alongside chatview +
   *  sharedWorkbench. Load them only when the project's suites assert real
   *  translated copy for those namespaces. */
  extraNamespaces?: Record<string, TestNamespaceResources>;
}

function buildResources(extraNamespaces: Record<string, TestNamespaceResources>): Resource {
  const extraZh: Record<string, Record<string, unknown>> = {};
  const extraEn: Record<string, Record<string, unknown>> = {};
  for (const [name, bundle] of Object.entries(extraNamespaces)) {
    extraZh[name] = bundle.zh;
    extraEn[name] = bundle.en;
  }
  return {
    zh: {
      [CHATVIEW_I18N_NAMESPACE]: chatviewResources.zh,
      [SHARED_WORKBENCH_I18N_NAMESPACE]: flattenResourceTree(sharedWorkbenchResources.zh),
      ...extraZh,
    },
    en: {
      [CHATVIEW_I18N_NAMESPACE]: chatviewResources.en,
      [SHARED_WORKBENCH_I18N_NAMESPACE]: flattenResourceTree(sharedWorkbenchResources.en),
      ...extraEn,
    },
  };
}

/**
 * Create and register an isolated test i18next instance.
 *
 * `init` completes synchronously for static resources, so setups can
 * register the instance at module scope without top-level await.
 */
export function createTestI18n(options: TestI18nOptions = {}): TestI18nInstance {
  const {
    lng = TEST_I18N_DEFAULT_LNG,
    fallbackLng = TEST_I18N_FALLBACK_LNG,
    defaultNS = 'chatview',
    extraNamespaces = {},
  } = options;

  const resources = buildResources(extraNamespaces);
  const namespaces = [
    CHATVIEW_I18N_NAMESPACE,
    SHARED_WORKBENCH_I18N_NAMESPACE,
    ...Object.keys(extraNamespaces),
  ];

  const initOptions: InitOptions = {
    resources,
    lng,
    fallbackLng,
    ns: namespaces,
    defaultNS,
    interpolation: { escapeValue: false },
  };

  const instance = i18next.createInstance();
  instance.use(initReactI18next);
  // initReactI18next registers the instance as the react-i18next default
  // (setI18n) inside its init hook; init() is synchronous for static
  // resources, so the instance is usable immediately after this call.
  instance.init(initOptions);
  return instance;
}

/**
 * Install the test instance into the running vitest project. Each project
 * setup calls this exactly once; the returned instance is intentionally
 * per-project and must not be shared across setups.
 */
export function installTestI18n(options?: TestI18nOptions): TestI18nInstance {
  return createTestI18n(options);
}
