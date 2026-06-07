/* ═══ Blocks barrel exports ═══ */

import type { ComponentProps } from 'react';

import { AgentMessage } from './AgentMessage';
import { UserMessage } from './UserMessage';
import { ToolCardBlock, STATUS_LABELS as TOOL_STATUS_LABELS } from './ToolCardBlock';
import { FileChangeCard } from './FileChangeCard';
import { DiffCard } from './DiffCard';
import { DateDivider } from './DateDivider';
import { PinnedAnnouncement } from './PinnedAnnouncement';
import { ApprovalCardBlock } from './ApprovalCardBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { SubagentBlock } from './SubagentBlock';
import { ChildAgentBlock } from './ChildAgentBlock';
import { RunSessionCard } from './RunSessionCard';
import { ResultBlock } from './ResultBlock';
import { RouteDecisionBlock, STATUS_LABELS } from './RouteDecisionBlock';
import { ContextUsageBlock } from './ContextUsageBlock';
import { AgentTimeline } from './AgentTimeline';
import { RunStepGroup } from './RunStepGroup';

export {
  AgentMessage,
  UserMessage,
  ToolCardBlock,
  TOOL_STATUS_LABELS,
  FileChangeCard,
  DiffCard,
  DateDivider,
  PinnedAnnouncement,
  ApprovalCardBlock,
  ThinkingBlock,
  SubagentBlock,
  ChildAgentBlock,
  RunSessionCard,
  ResultBlock,
  RouteDecisionBlock,
  STATUS_LABELS,
  ContextUsageBlock,
  AgentTimeline,
  RunStepGroup,
};

/* ── Prop types ── */

export type AgentMessageProps = ComponentProps<typeof AgentMessage>;
export type UserMessageProps = ComponentProps<typeof UserMessage>;
export type ToolCardBlockProps = ComponentProps<typeof ToolCardBlock>;
export type FileChangeCardProps = ComponentProps<typeof FileChangeCard>;
export type DiffCardProps = ComponentProps<typeof DiffCard>;
export type DateDividerProps = ComponentProps<typeof DateDivider>;
export type PinnedAnnouncementProps = ComponentProps<typeof PinnedAnnouncement>;
export type ApprovalCardBlockProps = ComponentProps<typeof ApprovalCardBlock>;
export type ThinkingBlockProps = ComponentProps<typeof ThinkingBlock>;
export type SubagentBlockProps = ComponentProps<typeof SubagentBlock>;
export type ChildAgentBlockProps = ComponentProps<typeof ChildAgentBlock>;
export type RunSessionCardProps = ComponentProps<typeof RunSessionCard>;
export type ResultBlockProps = ComponentProps<typeof ResultBlock>;
export type RouteDecisionBlockProps = ComponentProps<typeof RouteDecisionBlock>;
export type ContextUsageBlockProps = ComponentProps<typeof ContextUsageBlock>;
export type AgentTimelineProps = ComponentProps<typeof AgentTimeline>;
export type RunStepGroupProps = ComponentProps<typeof RunStepGroup>;
