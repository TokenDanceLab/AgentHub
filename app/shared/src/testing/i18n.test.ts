// real_tested=true
import i18next from 'i18next';
import { getI18n, setI18n } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { CHATVIEW_I18N_NAMESPACE, chatviewResources } from '../chatview/i18n/resources';
import {
  SHARED_WORKBENCH_I18N_NAMESPACE,
  flattenSharedWorkbenchResource,
  sharedWorkbenchResources,
} from '../i18n';
import {
  TEST_I18N_DEFAULT_LNG,
  TEST_I18N_FALLBACK_LNG,
  createTestI18n,
  installTestI18n,
  useTestI18nLanguage,
  type TestNamespaceResources,
} from './i18n';

const extraBundle: TestNamespaceResources = {
  zh: { greeting: '你好', zhOnly: '仅中文' },
  en: { greeting: 'Hello', enOnly: 'English only' },
};

const extraNamespaces = { extra: extraBundle };

describe('TEST_I18N constants', () => {
  it('uses a pseudo-language that matches no registered bundle', () => {
    expect(TEST_I18N_DEFAULT_LNG).toBe('test');
  });

  it('disables fallback languages by default', () => {
    expect(TEST_I18N_FALLBACK_LNG).toBe(false);
  });
});

describe('createTestI18n defaults', () => {
  it('initializes synchronously with key-echo language and chatview as default ns', () => {
    const instance = createTestI18n();

    expect(instance.isInitialized).toBe(true);
    expect(instance.language).toBe('test');
    expect(instance.options.defaultNS).toBe('chatview');
    expect(instance.options.ns).toEqual(['chatview', 'sharedWorkbench']);
  });

  it('disables interpolation escaping', () => {
    const instance = createTestI18n();

    expect(instance.options.interpolation?.escapeValue).toBe(false);
  });

  it('echoes keys verbatim when the language has no bundle', () => {
    const instance = createTestI18n();

    expect(instance.t('typing.dm')).toBe('typing.dm');
    expect(instance.t('deeply.nested.missing.key')).toBe('deeply.nested.missing.key');
  });

  it('still honors t(key, defaultValue) in key-echo mode', () => {
    const instance = createTestI18n();

    expect(instance.t('typing.dm', { defaultValue: 'fallback copy' })).toBe('fallback copy');
  });
});

describe('createTestI18n language selection', () => {
  it('resolves real zh copy when lng is zh', () => {
    const instance = createTestI18n({ lng: 'zh' });

    expect(instance.language).toBe('zh');
    expect(instance.t('typing.dm')).toBe('正在输入...');
    expect(instance.t('chat.you')).toBe('你');
  });

  it('resolves real en copy when lng is en', () => {
    const instance = createTestI18n({ lng: 'en' });

    expect(instance.language).toBe('en');
    expect(instance.t('typing.dm')).toBe('Typing...');
    expect(instance.t('chat.you')).toBe('You');
  });

  it('interpolates data into zh templates', () => {
    const instance = createTestI18n({ lng: 'zh' });

    expect(instance.t('typing.single', { name: 'Bob' })).toBe('Bob 正在输入...');
  });

  it('does not escape interpolated values (escapeValue false)', () => {
    const instance = createTestI18n({ lng: 'zh' });

    expect(instance.t('typing.single', { name: '<b>Alice</b>' })).toBe('<b>Alice</b> 正在输入...');
  });

  it('accepts an unknown lng without throwing and echoes keys', () => {
    const instance = createTestI18n({ lng: 'not-a-real-language' });

    expect(instance.language).toBe('not-a-real-language');
    expect(instance.t('typing.dm')).toBe('typing.dm');
  });
});

describe('createTestI18n resources', () => {
  it('re-uses the production chatview bundles by reference', () => {
    const instance = createTestI18n();

    expect(instance.getResourceBundle('zh', CHATVIEW_I18N_NAMESPACE)).toBe(chatviewResources.zh);
    expect(instance.getResourceBundle('en', CHATVIEW_I18N_NAMESPACE)).toBe(chatviewResources.en);
  });

  it('flattens the zh sharedWorkbench tree like the production helper', () => {
    const instance = createTestI18n();
    const bundle = (instance.getResourceBundle('zh', SHARED_WORKBENCH_I18N_NAMESPACE) ?? {}) as Record<
      string,
      string
    >;

    expect(Object.keys(bundle).sort()).toEqual(
      flattenSharedWorkbenchResource(sharedWorkbenchResources.zh).sort(),
    );
  });

  it('flattens the en sharedWorkbench tree like the production helper', () => {
    const instance = createTestI18n();
    const bundle = (instance.getResourceBundle('en', SHARED_WORKBENCH_I18N_NAMESPACE) ?? {}) as Record<
      string,
      string
    >;

    expect(Object.keys(bundle).sort()).toEqual(
      flattenSharedWorkbenchResource(sharedWorkbenchResources.en).sort(),
    );
  });

  it('keeps leaf keys after flattening', () => {
    const instance = createTestI18n({ lng: 'zh' });
    const bundle = (instance.getResourceBundle('zh', SHARED_WORKBENCH_I18N_NAMESPACE) ?? {}) as Record<
      string,
      string
    >;

    expect(bundle['nav.chat']).toBe('对话');
    expect(bundle['contacts.empty.title']).toBe('暂无联系人');
  });

  it('removes nested section keys so lookups resolve the defaultValue fallback', () => {
    const instance = createTestI18n({ lng: 'zh' });
    const bundle = (instance.getResourceBundle('zh', SHARED_WORKBENCH_I18N_NAMESPACE) ?? {}) as Record<
      string,
      string
    >;

    expect(bundle).not.toHaveProperty('contacts');
    expect(bundle).not.toHaveProperty('contacts.empty');
    expect(instance.t('contacts.empty', { ns: 'sharedWorkbench', defaultValue: 'FALLBACK' })).toBe(
      'FALLBACK',
    );
  });

  it('resolves flattened sharedWorkbench values per language', () => {
    const zh = createTestI18n({ lng: 'zh' });
    const en = createTestI18n({ lng: 'en' });

    expect(zh.t('nav.chat', { ns: 'sharedWorkbench' })).toBe('对话');
    expect(en.t('nav.chat', { ns: 'sharedWorkbench' })).toBe('Chats');
    expect(zh.t('contacts.empty.title', { ns: 'sharedWorkbench' })).toBe('暂无联系人');
    expect(en.t('contacts.empty.title', { ns: 'sharedWorkbench' })).toBe('No contacts yet');
  });

  it('merges extra namespaces alongside the built-ins', () => {
    const instance = createTestI18n({ extraNamespaces });

    expect(instance.getResourceBundle('zh', 'extra')).toBe(extraBundle.zh);
    expect(instance.getResourceBundle('en', 'extra')).toBe(extraBundle.en);
    expect(instance.options.ns).toEqual(['chatview', 'sharedWorkbench', 'extra']);
    expect(instance.getResourceBundle('zh', CHATVIEW_I18N_NAMESPACE)).toBe(chatviewResources.zh);
    expect(instance.getResourceBundle('en', SHARED_WORKBENCH_I18N_NAMESPACE)).toBeDefined();
  });

  it('lets project setups override the default namespace', () => {
    const instance = createTestI18n({ lng: 'en', defaultNS: 'extra', extraNamespaces });

    expect(instance.options.defaultNS).toBe('extra');
    expect(instance.t('greeting')).toBe('Hello');
  });

  it('echoes extra-namespace keys under the default test language', () => {
    const instance = createTestI18n({ extraNamespaces });

    expect(instance.t('greeting', { ns: 'extra' })).toBe('greeting');
  });
});

describe('createTestI18n fallback behavior', () => {
  it('does not fall through to en when fallbackLng is disabled', () => {
    const instance = createTestI18n({ lng: 'zh', extraNamespaces });

    expect(instance.t('enOnly', { ns: 'extra' })).toBe('enOnly');
  });

  it('falls through to en for keys missing from zh when fallbackLng is en', () => {
    const instance = createTestI18n({ lng: 'zh', fallbackLng: 'en', extraNamespaces });

    expect(instance.t('enOnly', { ns: 'extra' })).toBe('English only');
  });

  it('falls back across the whole language when lng has no bundle at all', () => {
    const instance = createTestI18n({ lng: 'fr', fallbackLng: 'en' });

    expect(instance.t('typing.dm')).toBe('Typing...');
  });

  it('falls back in the reverse direction from en to zh', () => {
    const instance = createTestI18n({ lng: 'en', fallbackLng: 'zh', extraNamespaces });

    expect(instance.t('zhOnly', { ns: 'extra' })).toBe('仅中文');
  });

  it('prefers an explicit defaultValue when the key is missing everywhere', () => {
    const instance = createTestI18n({ lng: 'zh', fallbackLng: 'en', extraNamespaces });

    expect(instance.t('completely.missing.key', { defaultValue: 'DEFAULT' })).toBe('DEFAULT');
  });
});

describe('createTestI18n isolation and registration', () => {
  it('returns a distinct instance on every call', () => {
    const first = createTestI18n();
    const second = createTestI18n();

    expect(first).not.toBe(second);
    expect(first).not.toBe(i18next);
  });

  it('registers each created instance as the react-i18next default', () => {
    const instance = createTestI18n({ lng: 'en' });

    expect(getI18n()).toBe(instance);
    expect(getI18n().language).toBe('en');
  });

  it('leaves the i18next module default singleton untouched', () => {
    createTestI18n({ lng: 'zh' });

    expect(i18next.isInitialized).toBeFalsy();
  });
});

describe('useTestI18nLanguage', () => {
  it('switches the registered instance to zh', async () => {
    const instance = createTestI18n();

    const result = useTestI18nLanguage('zh');
    expect(result).toBeDefined();
    await result;

    expect(getI18n()).toBe(instance);
    expect(getI18n().language).toBe('zh');
    expect(getI18n().t('typing.dm')).toBe('正在输入...');
  });

  it('switches back to the key-echo pseudo-language', async () => {
    createTestI18n();
    await useTestI18nLanguage('zh');

    await useTestI18nLanguage('test');

    expect(getI18n().language).toBe('test');
    expect(getI18n().t('typing.dm')).toBe('typing.dm');
  });

  it('returns undefined when no react-i18next instance is registered', () => {
    // Clear the react-i18next module default so the optional chain short-circuits.
    setI18n(undefined as never);
    try {
      expect(useTestI18nLanguage('zh')).toBeUndefined();
    } finally {
      installTestI18n(); // restore a registered instance for later tests
    }
  });

  it('accepts an unknown language without throwing and keeps echoing keys', async () => {
    createTestI18n();

    await useTestI18nLanguage('no-such-language');

    expect(getI18n().language).toBe('no-Such-language');
    expect(getI18n().t('typing.dm')).toBe('typing.dm');
  });
});

describe('installTestI18n', () => {
  it('returns a registered instance honoring the given options', () => {
    const instance = installTestI18n({ lng: 'en' });

    expect(instance.language).toBe('en');
    expect(instance.t('typing.dm')).toBe('Typing...');
    expect(getI18n()).toBe(instance);
  });

  it('produces a distinct instance per install and re-registers the default', () => {
    const first = installTestI18n({ lng: 'zh' });
    const second = installTestI18n({ lng: 'en' });

    expect(first).not.toBe(second);
    expect(getI18n()).toBe(second);
  });

  it('installs the key-echo defaults when called without options', () => {
    const instance = installTestI18n();

    expect(instance.language).toBe(TEST_I18N_DEFAULT_LNG);
    expect(instance.options.defaultNS).toBe('chatview');
    expect(instance.options.ns).toEqual(['chatview', 'sharedWorkbench']);
    expect(instance.t('typing.dm')).toBe('typing.dm');
  });
});
