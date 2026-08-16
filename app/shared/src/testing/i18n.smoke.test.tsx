/* ═══════════════════════════════════════════════════════════════════════
   I18N SMOKE — proves the project setup registered a real test instance.

   No local react-i18next mock here: `useTranslation` / `getI18n` must
   resolve through the instance installed by the owning vitest setup
   (shared/desktop/web). If a setup stops installing its instance, `getI18n()`
   returns undefined and these assertions fail — the negative guard for
   Issue #1717. The NO_I18NEXT_INSTANCE warning is asserted absent on the
   console for a real useTranslation consumer render.
   ═══════════════════════════════════════════════════════════════════════ */

import { renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getI18n, useTranslation } from 'react-i18next';

import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import { useTestI18nLanguage } from './i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

describe('test i18next instance registration', () => {
  it('resolves real translations through useTranslation without NO_I18NEXT_INSTANCE', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    let capturedCalls: unknown[][] = [];
    try {
      const { result } = renderHook(() => useTranslation(CHATVIEW_I18N_NAMESPACE));

      expect(result.current.i18n.isInitialized).toBe(true);
      expect(result.current.t('code.copy')).toBe('复制');
      capturedCalls = warnSpy.mock.calls;
    } finally {
      warnSpy.mockRestore();
    }

    const i18nWarning = capturedCalls.find((args) =>
      (args[1] as { code?: string } | undefined)?.code === 'NO_I18NEXT_INSTANCE',
    );
    expect(i18nWarning).toBeUndefined();
  });

  it('exposes an initialized default instance via getI18n', () => {
    const i18n = getI18n();

    expect(i18n).toBeDefined();
    expect(i18n?.isInitialized).toBe(true);
    expect(i18n?.t('chatview:code.copy')).toBe('复制');
  });
});
