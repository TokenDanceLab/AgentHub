import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposerMention } from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { formatMentionChipLabel } from './ComposerPartsHelpers';
import type { MentionPopoverCoords } from './composerMentionPopoverHelpers';
import styles from './AgentHubWorkbench.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   ComposerMentionPopover — presentational @mention candidate list (T11/UI1).

   Rendered by UnifiedComposer when an active '@' trigger is detected in
   the textarea. Pure: the host owns trigger/query/activeIndex/coords and
   feeds them in. Keyboard navigation (Arrow/Enter/Esc) is handled by the
   host's textarea keydown via planMentionPopoverKeyDown; the textarea keeps
   focus, so option clicks use onMouseDown + preventDefault to avoid blur.

   Reuses ComposerMention + dispatchRole: the host routes selection through
   planAddMentionAction → addMention, preserving the dispatch semantics.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ComposerMentionPopoverProps {
  candidates: ComposerMention[];
  activeIndex: number;
  coords: MentionPopoverCoords | null;
  /** Stable id of the listbox node, used by the textarea aria-activedescendant. */
  listboxId: string;
  onSelect: (mention: ComposerMention) => void;
  onHover: (index: number) => void;
}

export function ComposerMentionPopover({
  candidates,
  activeIndex,
  coords,
  listboxId,
  onSelect,
  onHover,
}: ComposerMentionPopoverProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const style: React.CSSProperties = coords
    ? { top: coords.top, left: coords.left }
    : { bottom: 120, left: '50%', transform: 'translateX(-50%)' };
  return (
    <div
      id={listboxId}
      className={styles.composerMentionPopover}
      style={style}
      role="listbox"
      aria-label={t('composer.mentionHint')}
      data-placement={coords?.placement ?? 'up'}
    >
      <span className={styles.composerMentionHint}>{t('composer.mentionHint')}</span>
      {candidates.length === 0 ? (
        <div className={styles.composerMentionEmpty}>{t('composer.mentionEmpty')}</div>
      ) : (
        candidates.map((mention, index) => {
          const meta = [mention.runtimeId, mention.model].filter(Boolean).join(' · ');
          return (
            <button
              key={mention.id}
              id={`${listboxId}-opt-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex}
              className={styles.composerMentionOption}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(mention);
              }}
              onMouseEnter={() => onHover(index)}
            >
              <span className={styles.composerMentionOptionLabel}>
                {formatMentionChipLabel(mention)}
              </span>
              {meta && <span className={styles.composerMentionOptionMeta}>{meta}</span>}
            </button>
          );
        })
      )}
    </div>
  );
}
