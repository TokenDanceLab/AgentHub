// Shared UI primitives consumed across desktop/web/mobile-rn product surfaces.
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export { DiffReviewPanel } from './DiffReviewPanel';
export type { DiffReviewFile, DiffReviewLabels, DiffHunkDecision, DiffReviewPanelProps } from './DiffReviewPanel';
export { Select } from './Select';
export type { SelectProps } from './Select';
export { EmptyState } from './EmptyState';
export { EMPTY_STATE_KINDS, resolveEmptyStateCopy } from './EmptyState';
export type {
  EmptyStateProps,
  EmptyStateAction,
  EmptyStateSuggestion,
  EmptyStateKind,
  EmptyStateCopy,
  EmptyStateCopyMatrix,
} from './EmptyState';
export { SelectableRow } from './SelectableRow';
export type { SelectableRowProps } from './SelectableRow';
export { TokenDanceMark } from './TokenDanceMark';
export type { TokenDanceMarkProps } from './TokenDanceMark';
export { CodePreviewCard } from './CodePreviewCard';
export type { CodePreviewCardProps } from './CodePreviewCard';
export { DisclosureRow } from './DisclosureRow';
export type { DisclosureRowProps } from './DisclosureRow';
export { MetricGrid } from './MetricGrid';
export type { MetricGridItem, MetricGridProps } from './MetricGrid';
export { MessageBubble } from './MessageBubble';
export type { MessageBubbleProps } from './MessageBubble';
export { ActivityCard } from './ActivityCard';
export type { ActivityCardProps } from './ActivityCard';
export { ContextSummary } from './ContextSummary';
export type { ContextSummaryProps, ContextSummaryItem } from './ContextSummary';
export { SectionHeader } from './SectionHeader';
export type { SectionHeaderProps, SectionHeaderAction } from './SectionHeader';
export { StatusNotice } from './StatusNotice';
export type { StatusNoticeProps } from './StatusNotice';
export { RecoveryPanel } from './RecoveryPanel';
export type { RecoveryPanelProps } from './RecoveryPanel';
export { ActionList } from './ActionList';
export type { ActionListProps } from './ActionList';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedControlOption } from './SegmentedControl';
export { SurfaceHeader } from './SurfaceHeader';
export type { SurfaceHeaderProps } from './SurfaceHeader';
export { TriageCard } from './TriageCard';
export type { TriageCardProps } from './TriageCard';
export { ToolTimeline } from './ToolTimeline';
export type {
  ToolTimelineToolUse,
  ToolTimelineFileChange,
  ToolTimelineAgentTask,
  ToolTimelineChildAgent,
  ToolTimelineRouteDecision,
  ToolTimelineBlock,
  ToolTimelineLabels,
  ToolTimelineProps,
} from './ToolTimeline';
export {
  RuntimeIcon,
  resolveRuntimeIcon,
  RuntimeBrandIcon,
  resolveRuntimeBrandIcon,
} from './RuntimeIcon';
export type {
  RuntimeIconKind,
  RuntimeIconProps,
  RuntimeIconResolution,
  RuntimeIconSize,
  RuntimeIconSource,
  RuntimeBrandIconKind,
  RuntimeBrandIconProps,
  RuntimeBrandIconResolution,
  RuntimeBrandIconSize,
  RuntimeBrandIconSource,
} from './RuntimeIcon';
export {
  normalizeRuntimeIconKey,
  resolveRuntimeIconRegistry,
  runtimeIconRegistry,
} from './runtimeIconRegistry';
export type { RuntimeIconRegistry, RuntimeIconRegistryInput } from './runtimeIconRegistry';
export { PermissionModePicker } from './PermissionModePicker';
export type { PermissionModePickerProps, PermissionModeOption } from './PermissionModePicker';
export { ArtifactCard } from './ArtifactCard';
export type { ArtifactCardProps } from './ArtifactCard';
export { PREVIEW_SANDBOX_REMOTE, PREVIEW_SANDBOX_SRCDOC } from './previewSandbox';
export { DeployCard } from './DeployCard';
export type { DeployCardProps } from './DeployCard';
export { SlideshowPreview } from './SlideshowPreview';
export type { SlideshowPreviewProps } from './SlideshowPreview';
export { TablePreview } from './TablePreview';
export type { TablePreviewProps } from './TablePreview';
export { DocxPreview } from './DocxPreview';
export type { DocxPreviewProps } from './DocxPreview';
export { AgentStreamingBar } from './AgentStreamingBar';
export type { AgentStreamingBarProps } from './AgentStreamingBar';
export { DagTree } from './DagTree';
export type { DagTreeProps, DagNode, DagNodeStatus } from './DagTree';
export { default as MarkdownContent } from './Markdown';
export type { MarkdownContentProps } from './Markdown';
export { RiskBadge } from './RiskBadge';
export type { RiskBadgeProps, RiskLevel } from './RiskBadge';
export { cx } from './cx';
export { Tooltip } from './Tooltip';
export type { TooltipProps, TooltipSide } from './Tooltip';
export { default as ErrorBoundary } from './ErrorBoundary';
export type { ErrorConfig, ErrorBoundaryExtension } from './ErrorBoundary';

// ── Wave 9 public barrel additions (previously exported only from file paths) ──
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Avatar } from './Avatar';
export { Pill } from './Pill';
export { Card, CardHeader, CardContent, CardFooter } from './Card';
export { CodeBlock } from './CodeBlock';
export { CollapsibleBlock } from './CollapsibleBlock';
export { FileChangeGroup } from './FileChangeGroup';
export type { FileChangeGroupProps, FileChangeItem } from './FileChangeGroup';
export { Icon } from './Icon';
export { ProgressBar } from './ProgressBar';
export { SkeletonBar } from './SkeletonBar';
export type { SkeletonBarProps, SkeletonBarVariant } from './SkeletonBar';