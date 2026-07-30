/* ═══════════════════════════════════════════════════════════════════════
   TYPING INDICATOR — ephemeral "X is typing..." bar
   ══════════════════════════════════════════════════════════════════════ */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources';
import './TypingIndicator.css';

interface Props {
  names: string[];
  chatMode?: 'dm' | 'group';
}

export const TypingIndicator = memo(function TypingIndicator({ names, chatMode = 'group' }: Props) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  if (names.length === 0) return null;
  if (chatMode === 'dm') {
    return (
      <div className="typingIndicator" aria-live="polite" aria-atomic="true">
        <span className="typingDots">
          <span className="typingDot" /><span className="typingDot" /><span className="typingDot" />
        </span>
        <span>{t('typing.dm')}</span>
      </div>
    );
  }
  const label = names.length === 1
    ? t('typing.single', { name: names[0] })
    : names.length === 2
      ? t('typing.double', { name1: names[0], name2: names[1] })
      : t('typing.multiple', { count: names.length });
  return (
    <div className="typingIndicator" aria-live="polite" aria-atomic="true">
      <span className="typingDots">
        <span className="typingDot" /><span className="typingDot" /><span className="typingDot" />
      </span>
      <span>{label}</span>
    </div>
  );
});
