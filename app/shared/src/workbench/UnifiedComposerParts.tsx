/* ═══════════════════════════════════════════════════════════════════════
   UnifiedComposer presentational subpanels — residual barrel (#706).

   Subcomponents live in ComposerContextParts / ComposerAttachmentParts /
   ComposerControlParts. Pure helpers in ComposerPartsHelpers.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  ComposerMainchainStrip,
  ComposerMentionChips,
  ComposerQuoteBar,
  ComposerReplyBar,
  ComposerStatusStrip,
} from './ComposerContextParts';

export {
  ComposerAttachmentBar,
  ComposerAttachmentChip,
} from './ComposerAttachmentParts';

export {
  ComposerAgentPicker,
  ComposerAttachButton,
  ComposerSendButton,
  ComposerTargetPicker,
} from './ComposerControlParts';
