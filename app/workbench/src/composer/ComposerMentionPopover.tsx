import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposerMention } from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { formatMentionChipLabel } from './ComposerPartsHelpers';
import type { MentionPopoverCoords } from './composerMentionPopoverHelpers';

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
      className="fixed z-[9999] w-[min(300px,calc(100vw_-_32px))] max-h-[280px] overflow-y-auto rounded-xl border border-line-strong bg-card p-1 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.28)] ring-1 ring-foreground/5"
      style={style}
      role="listbox"
      aria-label={t('composer.mentionHint')}
      data-placement={coords?.placement ?? 'up'}
    >
      <span className="block px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
        {t('composer.mentionHint')}
      </span>
      {candidates.length === 0 ? (
        <div className="px-2.5 py-6 text-center text-xs text-muted-foreground">
          {t('composer.mentionEmpty')}
        </div>
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
              className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted data-[active=true]:bg-muted"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(mention);
              }}
              onMouseEnter={() => onHover(index)}
            >
              <span className="truncate font-medium">
                {formatMentionChipLabel(mention)}
              </span>
              {meta && <span className="truncate text-[11px] text-muted-foreground">{meta}</span>}
            </button>
          );
        })
      )}
    </div>
  );
}
