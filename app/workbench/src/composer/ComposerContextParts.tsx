import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ComposerMention,
  ComposerState,
} from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { Button } from '@shared/shadcn/ui/button';
import { cn } from '@shared/lib/utils';
import { DesignNavIcon } from '../designIcons';
import {
  formatMentionChipLabel,
  formatReplyToLabel,
} from './ComposerPartsHelpers';
import { formatQuotePreview } from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   Composer context chrome — reply / quote / mentions / mainchain / status.

   Helper module for UnifiedComposerParts (#706).
   ═══════════════════════════════════════════════════════════════════════ */

const contextBarClass =
  'flex min-w-0 items-center gap-2 rounded-lg border border-line bg-muted/40 px-3 py-2 text-xs text-muted-foreground';
const contextLabelClass = 'min-w-0 flex-1 truncate';

export function ComposerReplyBar({
  replyTo,
  isSubmitting,
  onCancel,
}: {
  replyTo: NonNullable<ComposerState['replyTo']>;
  isSubmitting: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={contextBarClass}>
      <span className={contextLabelClass}>
        {formatReplyToLabel(replyTo, t)}
      </span>
      <Button
        aria-label={t('aria.cancelReply')}
        className="size-6 shrink-0 rounded-md text-muted-foreground"
        disabled={isSubmitting}
        size="icon-xs"
        onClick={onCancel}
        type="button"
        variant="ghost"
      >
        <DesignNavIcon name="close" size={12} />
      </Button>
    </div>
  );
}

export function ComposerQuoteBar({
  quote,
  isSubmitting,
  onCancel,
}: {
  quote: NonNullable<ComposerState['quote']>;
  isSubmitting: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={cn(contextBarClass, 'border-l-2 border-l-primary/60')}>
      <span className={cn(contextLabelClass, 'italic')}>
        {formatQuotePreview(quote)}
      </span>
      <Button
        aria-label={t('aria.cancelQuote')}
        className="size-6 shrink-0 rounded-md text-muted-foreground"
        disabled={isSubmitting}
        size="icon-xs"
        onClick={onCancel}
        type="button"
        variant="ghost"
      >
        <DesignNavIcon name="close" size={12} />
      </Button>
    </div>
  );
}

/**
 * Edit-context bar shown above the composer while editing an already-sent
 * message (#1462). Reuses the reply bar chrome so no new CSS is needed.
 */
export function ComposerEditBar({
  isSubmitting,
  onCancel,
}: {
  isSubmitting: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={contextBarClass} data-edit-bar="true">
      <span className={contextLabelClass}>{t('composer.editingMessage')}</span>
      <Button
        aria-label={t('aria.cancelEdit')}
        className="size-6 shrink-0 rounded-md text-muted-foreground"
        disabled={isSubmitting}
        size="icon-xs"
        onClick={onCancel}
        type="button"
        variant="ghost"
      >
        <DesignNavIcon name="close" size={12} />
      </Button>
    </div>
  );
}

export function ComposerMentionChips({
  mentions,
  isSubmitting,
  onRemove,
}: {
  mentions: ComposerMention[];
  isSubmitting: boolean;
  onRemove: (mentionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div
      aria-label={t('aria.selectedAgents')}
      className="flex flex-wrap items-center gap-1.5"
    >
      {mentions.map((mention) => (
        <Button
          aria-label={t('action.removeMention', { label: mention.label })}
          className="h-7 max-w-[12rem] gap-1 rounded-full border border-primary/20 bg-primary/8 px-2.5 text-xs font-medium text-primary hover:bg-primary/12"
          disabled={isSubmitting}
          key={mention.id}
          size="xs"
          onClick={() => onRemove(mention.id)}
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true" className="shrink-0 font-semibold">@</span>
          <span className="truncate">{formatMentionChipLabel(mention)}</span>
          <DesignNavIcon className="shrink-0 opacity-60" name="close" size={10} />
        </Button>
      ))}
    </div>
  );
}

export function ComposerStatusStrip({
  statusItems,
}: {
  statusItems: string[];
}): React.ReactElement {
  return (
    <p
      className="w-full min-w-0 truncate px-1 text-[11px] leading-4 text-muted-foreground/60"
      role="status"
      title={statusItems.join(' · ')}
    >
      {statusItems.join(' · ')}
    </p>
  );
}
