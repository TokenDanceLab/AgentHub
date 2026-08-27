/**
 * Transient workbench UI intents for cross-column focus (#1992).
 *
 * These events are not transcript/store state: they only move the user's
 * current focus from a transcript artifact card to the mounted engineering
 * Preview tab. The conversation id is mandatory so a late event cannot bleed
 * into another conversation.
 */
export const WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT =
  'agenthub:engineering-preview-focus';

export interface EngineeringPreviewFocusDetail {
  conversationId: string;
  /** Real artifact id from the transcript/runtime evidence contract. */
  artifactId: string;
  /** Display path used only for diagnostics/fallback matching. */
  artifactPath?: string | undefined;
  /** Run id for diagnostics and future evidence disambiguation. */
  artifactRunId?: string | undefined;
}
