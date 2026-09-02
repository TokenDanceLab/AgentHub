// #2241 lane B task 1 — the "this client never wired that action" announcement
// must tell the truth in the user's language.
//
// `announceUnavailableAction` (workbenchTranscriptChromeActionMappers) resolves
// UNAVAILABLE_ACTION_TOAST_KEY through the dispatcher's `t`, which in
// production is `useTranslation(CHATVIEW_I18N_NAMESPACE)`. While the key was
// missing from the bundle, i18next echoed the key back and the dispatcher fell
// back to each effect's own failure copy ("置顶失败，请重试") — never silent and
// never a fake success, but it promises a retry that can *never* succeed on a
// client without the port.
//
// These tests drive the REAL dispatcher with a REAL i18next translate bound to
// the REAL shared chatview bundle: no stub `t`, no mocked resources. The
// expected copy is read out of `chatviewResources` and additionally pinned to
// its literal zh/en wording, and every case also asserts what the announcement
// is NOT (raw key / success copy / retry-flavoured failure copy) plus that no
// fake side effect ran.
import { describe, expect, it, vi } from 'vitest';
import { getI18n } from 'react-i18next';

import { CHATVIEW_I18N_NAMESPACE, chatviewResources } from '@shared/chatview/i18n/resources';
import {
  UNAVAILABLE_ACTION_TOAST_KEY,
  applyTranscriptChromeSideEffects,
  type TranscriptChromeSideEffect,
} from '../workbenchTranscriptChromeActionMappers';
import type { TranscriptChromeTranslate } from '../workbenchTranscriptChromeLabels';

type BundleLocale = 'zh' | 'en';

/** Real i18next translate for `lng`, bound to the real chatview namespace. */
function realTranslate(lng: BundleLocale): TranscriptChromeTranslate {
  const i18n = getI18n();
  if (!i18n) {
    throw new Error('test i18n instance missing — src/__tests__/setup.ts must installTestI18n()');
  }
  return i18n.getFixedT(lng, CHATVIEW_I18N_NAMESPACE) as unknown as TranscriptChromeTranslate;
}

/** Same handler shape the sibling dispatcher suite uses — every effect spy. */
function handlersFixture() {
  return {
    copyText: vi.fn(),
    softHideBlocks: vi.fn(),
    dispatchComposer: vi.fn(),
    focusComposer: vi.fn(),
    pulseBlock: vi.fn(),
    showWorkbenchToast: vi.fn(),
    exitSelection: vi.fn(),
  };
}

interface UnwiredCase {
  name: string;
  effects: TranscriptChromeSideEffect[];
  successMessage: string;
  failureMessage: string;
}

/**
 * The seven dispatcher gates that announce instead of breaking silently
 * (#2154). Each carries a deliberately retry-flavoured failure copy so the
 * "not the old fallback" assertion has teeth.
 */
const unwiredCases: UnwiredCase[] = [
  {
    name: 'pin',
    effects: [{ type: 'pin', messageId: 'm1', sessionId: 's1', successMessage: 'pin-ok', failureMessage: '置顶失败，请重试' }],
    successMessage: 'pin-ok',
    failureMessage: '置顶失败，请重试',
  },
  {
    name: 'unpin',
    effects: [{ type: 'unpin', messageId: 'm1', sessionId: 's1', successMessage: 'unpin-ok', failureMessage: '取消置顶失败，请重试' }],
    successMessage: 'unpin-ok',
    failureMessage: '取消置顶失败，请重试',
  },
  {
    name: 'forward',
    effects: [{ type: 'forward', messageId: 'm1', targetSessionIds: ['s2'], successMessage: 'forward-ok', failureMessage: '转发失败，请重试' }],
    successMessage: 'forward-ok',
    failureMessage: '转发失败，请重试',
  },
  {
    name: 'recall',
    effects: [{ type: 'recall', messageId: 'm1', successMessage: 'recall-ok', failureMessage: '撤回失败，请重试' }],
    successMessage: 'recall-ok',
    failureMessage: '撤回失败，请重试',
  },
  {
    name: 'react',
    effects: [{ type: 'react', messageId: 'm1', sessionId: 's1', emoji: '🔥', successMessage: 'react-ok', failureMessage: '添加表情失败，请重试' }],
    successMessage: 'react-ok',
    failureMessage: '添加表情失败，请重试',
  },
  {
    name: 'regenerate',
    effects: [{ type: 'regenerate', blockId: 'b1', successMessage: 'regen-ok', failureMessage: '重新生成失败，请重试' }],
    successMessage: 'regen-ok',
    failureMessage: '重新生成失败，请重试',
  },
  {
    name: 'approval',
    effects: [{
      type: 'approval',
      decision: { approvalId: 'req-1', decision: 'allow' },
      successMessage: 'approval-ok',
      failureMessage: '审批失败，请重试',
    }],
    successMessage: 'approval-ok',
    failureMessage: '审批失败，请重试',
  },
];

function expectHonestAnnouncement(
  testCase: UnwiredCase,
  handlers: ReturnType<typeof handlersFixture>,
  expectedCopy: string,
): void {
  expect(handlers.showWorkbenchToast, testCase.name).toHaveBeenCalledTimes(1);
  expect(handlers.showWorkbenchToast, testCase.name).toHaveBeenCalledWith(expectedCopy);
  // Not the raw key (i18next echo), not the success copy, not the old
  // retry-flavoured fallback.
  expect(handlers.showWorkbenchToast, testCase.name).not.toHaveBeenCalledWith(UNAVAILABLE_ACTION_TOAST_KEY);
  expect(handlers.showWorkbenchToast, testCase.name).not.toHaveBeenCalledWith(testCase.successMessage);
  expect(handlers.showWorkbenchToast, testCase.name).not.toHaveBeenCalledWith(testCase.failureMessage);
  // And still no fake side effect: nothing hidden, pulsed or dispatched.
  expect(handlers.softHideBlocks, testCase.name).not.toHaveBeenCalled();
  expect(handlers.pulseBlock, testCase.name).not.toHaveBeenCalled();
  expect(handlers.dispatchComposer, testCase.name).not.toHaveBeenCalled();
}

describe('unwired-action announcement copy (#2241)', () => {
  it('announces the dedicated zh copy for all seven unwired actions', () => {
    const t = realTranslate('zh');
    const expected = chatviewResources.zh[UNAVAILABLE_ACTION_TOAST_KEY];
    // Pinned literally: the wording is the deliverable (说真话 > 做得全).
    expect(expected).toBe('该操作在当前端未接入');
    for (const testCase of unwiredCases) {
      const handlers = handlersFixture();
      applyTranscriptChromeSideEffects(testCase.effects, handlers, t);
      expectHonestAnnouncement(testCase, handlers, expected);
    }
  });

  it('announces the dedicated en copy for all seven unwired actions', () => {
    const t = realTranslate('en');
    const expected = chatviewResources.en[UNAVAILABLE_ACTION_TOAST_KEY];
    expect(expected).toBe('This action is not wired in this client');
    for (const testCase of unwiredCases) {
      const handlers = handlersFixture();
      applyTranscriptChromeSideEffects(testCase.effects, handlers, t);
      expectHonestAnnouncement(testCase, handlers, expected);
    }
  });

  it('resolves a locale-specific copy in both languages instead of echoing the key', () => {
    const zh = realTranslate('zh')(UNAVAILABLE_ACTION_TOAST_KEY);
    const en = realTranslate('en')(UNAVAILABLE_ACTION_TOAST_KEY);
    expect(zh).toBe(chatviewResources.zh[UNAVAILABLE_ACTION_TOAST_KEY]);
    expect(en).toBe(chatviewResources.en[UNAVAILABLE_ACTION_TOAST_KEY]);
    // A missing key would echo identically in both languages — that is exactly
    // the pre-#2241 state this suite guards against.
    expect(zh).not.toBe(UNAVAILABLE_ACTION_TOAST_KEY);
    expect(zh).not.toBe(en);
  });
});
