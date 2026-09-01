/**
 * Chatview adapter single-block → RowItem mapper.
 * Peel companion of adapter (#1143). Pure only; zero behavior change.
 */

import type {
  TranscriptBlock,
  ThinkingTranscriptBlock,
  ToolCallTranscriptBlock, ToolResultTranscriptBlock,
  FileChangeTranscriptBlock, ArtifactTranscriptBlock,
  DiffTranscriptBlock, ApprovalTranscriptBlock,
  PermissionRequestTranscriptBlock, PermissionResultTranscriptBlock,
  RunSessionTranscriptBlock, SubagentTranscriptBlock,
  RouteDecisionTranscriptBlock, ContextUsageTranscriptBlock,
  DeployTranscriptBlock, AttachmentTranscriptBlock,
  FailureTranscriptBlock,
  ChildAgentTranscriptBlock, SubtaskTranscriptBlock,
  PreviewTranscriptBlock,
  CheckpointTranscriptBlock,
} from '../transcript/types'
import type { RowItem } from './types'
import {
  SEP,
  patchToDiffLines,
  statusNorm,
  deployStatusNorm,
  extractDomain,
  deriveTitleFromUrl,
} from './adapterShared'
import type { AttachmentRef } from '../composer/types'
import { isAudioFileName, isVideoFileName } from '../ui/mediaPreview'

/**
 * Attachment payload kind for the transcript row (#1939).
 *
 * Hub only distinguishes `image` from `file` attachments, so audio/video
 * arrive as `contentType: 'file'` and are re-derived here: the Hub-stored
 * mime type leads (`audio/*` / `video/*`), the filename extension is the
 * fallback for attachments stored with a generic/empty mime. Explicit
 * `image` content type is trusted as-is. Exported for behavior tests.
 */
export function resolveAttachmentKind(
  attachmentRef: AttachmentRef,
  contentType: 'image' | 'file',
): NonNullable<RowItem['attachmentKind']> {
  if (contentType === 'image') return 'image'
  // Hub-stored mime is authoritative when it names a media family;
  // otherwise (absent/generic mime, e.g. application/octet-stream) the
  // filename extension decides.
  const mime = (attachmentRef.mime_type ?? '').toLowerCase()
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (isAudioFileName(attachmentRef.name)) return 'audio'
  if (isVideoFileName(attachmentRef.name)) return 'video'
  return 'file'
}

/**
 * Map a single TranscriptBlock to a RowItem, or return `null`
 * if the block kind should be skipped (e.g. `'result'`, `'finished'`,
 * `'replay_gap'`, `'agent_timeline'`, `'run_step_group'`).
 *
 * Status mapping conventions (see the block comment above for full rationale):
 * - `'running'` -- in-flight / pending events (tool_call, thinking, deploy in progress)
 * - `'ok'`      -- finished / terminal events (tool_result, file_change, artifact, diff, etc.)
 * - `'fail'`    -- error events (failure, failed deploy, failed approval)
 * - `'waiting'` -- awaiting user input (permission_request)
 *
 * Uses statusNorm and deployStatusNorm for canonical
 * EvidenceRefStatus -> RowItem status conversion.
 */
export type ChatviewTranslate = (key: string) => string;

export function mapBlock(b: TranscriptBlock, translate?: ChatviewTranslate): RowItem | null {
  switch (b.kind) {
    case 'thinking': {
      const t = b as ThinkingTranscriptBlock
      return {
        id: t.id, type: 'think',
        label: '',
        status: t.isThinking ? 'running' : 'ok',
        collapsible: true,
        content: t.content || '',
      } as RowItem
    }

    case 'tool_call': {
      const t = b as ToolCallTranscriptBlock
      // Tool call is a running event by nature, but a completed transcript
      // may carry status:'completed' or evidenceRefs showing completion.
      const hasCompletedEvidence = t.evidenceRefs?.some(ref => ref.status === 'completed')
      const toolStatus = t.status === 'failed'
        ? 'fail'
        : (t.status === 'completed' || hasCompletedEvidence)
          ? 'ok'
          : 'running'
      const tn = t.toolName?.toLowerCase() ?? 'unknown'
      return {
        id: t.id, type: 'tool',
        label: t.toolName ?? tn,
        status: toolStatus,
        collapsible: true,
        toolName: tn,
        ...(t.callId ? { toolCallId: t.callId } : {}),
        content: t.summary || t.target,
        extra: t.target && !t.summary ? t.target : undefined,
      } as RowItem
    }

    case 'tool_result': {
      const t = b as ToolResultTranscriptBlock
      const tn = t.toolName?.toLowerCase() ?? 'unknown'
      return {
        id: t.id, type: 'tool',
        label: t.toolName ?? tn,
        status: statusNorm(t.status),
        collapsible: true,
        toolName: tn,
        ...(t.callId ? { toolCallId: t.callId } : {}),
        content: t.summary,
        isResult: true,
      } as RowItem
    }

    case 'file_change': {
      const t = b as FileChangeTranscriptBlock
      return {
        id: t.id, type: 'file',
        label: '',
        extra: t.path,
        status: 'ok',
        collapsible: true,
        fileOp: t.action === 'created' ? 'cr' : t.action === 'deleted' ? 'del' : 'mod',
        content: t.path?.split('.').pop()?.toUpperCase() || '',
        diffLines: t.patch ? patchToDiffLines(t.patch) : undefined,
      } as RowItem
    }

    case 'artifact': {
      const a = b as ArtifactTranscriptBlock
      const extraParts = [a.path || a.title]
      if (a.uri) extraParts.push(a.uri)
      if (a.mimeType) extraParts.push(a.mimeType)
      const extra = extraParts.filter(Boolean).join(SEP)
      // Runtime evidence uses artifact-<id> references when the direct
      // artifactId field is absent. Mirror the web evidence mapper's
      // conservative extraction: unknown ids are not invented.
      const evidenceArtifactRefId = a.evidenceRefs?.find((ref) => ref.kind === 'artifact')?.id
      const evidenceArtifactId = evidenceArtifactRefId?.startsWith('artifact-')
        ? evidenceArtifactRefId.slice('artifact-'.length)
        : undefined
      const artifactId = a.artifactId || evidenceArtifactId
      const artifactRunId = a.evidenceRefs
        ?.find((ref) => ref.kind === 'run')?.id.replace(/^run-/, '')
      return {
        id: a.id, type: 'file',
        label: '',
        extra,
        status: 'ok',
        collapsible: true,
        fileOp: a.action === 'deleted' ? 'del' : a.action === 'created' ? 'cr' : 'mod',
        content: (a.path || a.title)?.split('.').pop()?.toUpperCase() || a.artifactKind || '',
        ...(artifactId ? { artifactId } : {}),
        ...(artifactRunId && artifactId ? { artifactRunId } : {}),
        ...(artifactId && (a.path || a.title) ? { artifactPath: a.path || a.title } : {}),
      } as RowItem
    }

    case 'diff': {
      const d = b as DiffTranscriptBlock
      const ext = d.files?.[0]?.split('.').pop()?.toUpperCase() || ''
      const stats: string[] = [ext]
      if (d.additions !== undefined) stats.push(`+${d.additions}`)
      if (d.deletions !== undefined) stats.push(`-${d.deletions}`)
      return {
        id: d.id, type: 'file',
        label: d.title,
        extra: d.files?.[0] || '',
        status: 'ok',
        collapsible: true,
        fileOp: 'mod',
        content: stats.filter(Boolean).join(' '),
        diffLines: d.patch ? patchToDiffLines(d.patch) : undefined,
      } as RowItem
    }

    case 'approval':
    case 'permission_request':
    case 'permission_result': {
      const a = b as ApprovalTranscriptBlock | PermissionRequestTranscriptBlock | PermissionResultTranscriptBlock
      const parts: string[] = []
      if (a.toolName) parts.push(a.toolName)
      if ('risk' in a && a.risk) parts.push(a.risk)
      const baseReason = 'reason' in a ? a.reason : (a as ApprovalTranscriptBlock).title
      if (baseReason) parts.push(baseReason)
      // Permission requests are always waiting; others use statusNorm
      const st = b.kind === 'permission_request'
        ? 'waiting'
        : statusNorm(a.status)
      return {
        id: a.id, type: 'approval',
        label: 'title' in a ? a.title : '',
        status: st,
        collapsible: true, standalone: true,
        apReason: parts.filter(Boolean).join(SEP),
        riskLevel: 'risk' in a && a.risk ? a.risk : undefined,
        // #1819: waiting cards surface "requested at" from the block's
        // createdAt; decided cards show no pending meta (only waiting matters).
        ...(st === 'waiting' && a.createdAt ? { waitingSince: a.createdAt } : {}),
      } as RowItem
    }

    case 'run_session': {
      const r = b as RunSessionTranscriptBlock
      return {
        id: r.id, type: 'session',
        label: r.title,
        status: statusNorm(r.status || 'completed'),
        collapsible: true, standalone: true,
        sessionTags: [
          r.agentLabel ? `Agent: ${r.agentLabel}` : '',
          r.runtimeLabel ? `Runtime: ${r.runtimeLabel}` : '',
          r.meta || '',
        ].filter(Boolean),
      } as RowItem
    }

    case 'subagent':
    case 'subtask':
    case 'child_agent': {
      const block = b as SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock
      const name = block.kind === 'child_agent' ? block.agent : block.worker || block.title
      return {
        id: block.id, type: 'sub',
        label: name ? `Agent${SEP}${name}` : block.title,
        status: statusNorm(block.status),
        collapsible: true,
        content: block.summary || block.title,
      } as RowItem
    }

    case 'route_decision': {
      const r = b as RouteDecisionTranscriptBlock
      return {
        id: r.id, type: 'route',
        label: r.action,
        status: 'ok',
        collapsible: false, standalone: true,
        content: r.summary,
      } as RowItem
    }

    case 'context_usage': {
      const c = b as ContextUsageTranscriptBlock
      return {
        id: c.id, type: 'ctx',
        label: '',
        status: 'ok',
        collapsible: true, standalone: true,
        ctxPct: c.usagePercent || 0,
        ctxStats: [
          `in: ${((c.inputTokens || 0) / 1000).toFixed(1)}k`,
          `out: ${((c.outputTokens || 0) / 1000).toFixed(1)}k`,
          c.contextLimit ? `limit: ${(c.contextLimit / 1000).toFixed(0)}k` : '',
          c.cachePercent ? `cache: ${c.cachePercent}%` : '',
          c.cost || '',
          c.modelLabel || '',
        ].filter(Boolean),
      } as RowItem
    }

    case 'deploy': {
      const d = b as DeployTranscriptBlock
      const metaParts: string[] = []
      if (d.status) metaParts.push(d.status)
      if (d.deployType) metaParts.push(d.deployType)
      if (d.path) metaParts.push(d.path)
      if (d.artifactId) metaParts.push(d.artifactId)
      return {
        id: d.id, type: 'deploy',
        label: '',
        status: deployStatusNorm(d.status),
        collapsible: true, standalone: true,
        url: d.url,
        deployMeta: metaParts.length > 0 ? metaParts.join(SEP) : 'Deployed',
      } as RowItem
    }

    case 'attachment': {
      const a = b as AttachmentTranscriptBlock
      return {
        id: a.id, type: 'attachment',
        label: a.attachmentRef.name,
        extra: a.contentType,
        status: 'ok',
        collapsible: false, standalone: true,
        fileName: a.attachmentRef.name,
        fileSize: a.attachmentRef.size ? `${Math.round(a.attachmentRef.size / 1024)} KB` : undefined,
        // #1938/#1939: keep the kind marker + ref on the row so image and
        // audio/video attachments render inline previews (URL resolved
        // through the platform port) instead of degrading to a bare chip.
        attachmentKind: resolveAttachmentKind(a.attachmentRef, a.contentType),
        attachmentRef: a.attachmentRef,
      } as RowItem
    }

    case 'failure': {
      const f = b as FailureTranscriptBlock
      return {
        id: f.id, type: 'think',
        label: '',
        status: 'fail',
        collapsible: true,
        content: f.reason || f.title || translate?.('adapter.runFailed') || '运行失败',
      } as RowItem
    }

    case 'preview': {
      const p = b as PreviewTranscriptBlock
      const domain = p.url ? extractDomain(p.url) : ''
      const displayTitle = p.url ? deriveTitleFromUrl(p.url) : (p.previewId || '')
      return {
        id: p.id, type: 'preview',
        label: '',
        status: statusNorm(p.status),
        collapsible: false, standalone: true,
        url: p.url,
        previewDomain: domain,
        previewTitle: displayTitle,
      } as RowItem
    }

    case 'checkpoint': {
      const c = b as CheckpointTranscriptBlock
      return {
        id: c.id, type: 'checkpoint',
        label: '',
        status: 'ok',
        collapsible: false, standalone: true,
        checkpointId: c.checkpointId,
        checkpointRunId: c.runId,
        checkpointFileCount: c.fileCount,
        checkpointTotalBytes: c.totalBytes,
      } as RowItem
    }

    case 'result':
    case 'finished':
    case 'replay_gap':
    case 'agent_timeline':
    case 'run_step_group':
    case 'compact_boundary':
      return null

    default:
      return null
  }
}
