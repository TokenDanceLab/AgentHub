/* ═══════════════════════════════════════════════════════════════════════
   UnifiedComposer presentational subpanels — barrel module (#706).

   Subcomponents live in ComposerContextParts / ComposerAttachmentParts /
   ComposerControlParts. Pure helpers in ComposerPartsHelpers. Visuals use the
   shadcn/Tailwind token bridge; no composer chrome remains in the CSS module.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  ComposerMainchainStrip,
  ComposerMentionChips,
  ComposerQuoteBar,
  ComposerReplyBar,
  ComposerEditBar,
  ComposerStatusStrip,
} from './ComposerContextParts';

export {
  ComposerAttachmentBar,
  ComposerAttachmentChip,
} from './ComposerAttachmentParts';

export {
  ComposerAgentPicker,
  ComposerApprovalModePicker,
  ComposerAttachButton,
  ComposerSendButton,
  ComposerTargetPicker,
} from './ComposerControlParts';
