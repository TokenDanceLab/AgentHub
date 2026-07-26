import { describe, expect, it } from 'vitest';
import type {
  AgentInstance,
  AgentProfile,
  AgentTaskApproval,
  AgentTaskArtifact,
  AgentTeam,
  AgentTeamDetail,
  AgentTeamRun,
  AttachmentRef,
  CoordinatorRouteDecision,
  CreateAgentProfileRequest,
  CreateAgentTeamRequest,
  CreateHubDocumentRequest,
  HubAgentInstance,
  HubAgentProfile,
  HubAgentRunEvent,
  HubAgentRunEventSummary,
  HubAgentTaskApproval,
  HubAgentTaskApprovalList,
  HubAgentTaskArtifact,
  HubAgentTaskArtifactList,
  HubAgentTaskStreamEventOptions,
  HubAgentTeam,
  HubAgentTeamAssignment,
  HubAgentTeamDetail,
  HubAgentTeamEvent,
  HubAgentTeamMember,
  HubAgentTeamRun,
  HubAgentTeamTask,
  HubAttachmentRef,
  HubCoordinatorRouteDecision,
  HubCreateAgentProfileRequest,
  HubCreateAgentTeamRequest,
  HubCreateDocumentRequest,
  HubDocument,
  HubDocumentListItem,
  HubDocumentListResponse,
  HubPendingAgentTask,
  HubProbeAttachmentResponse,
  HubStartAgentTeamRunRequest,
  HubTaskApprovalDecisionRequest,
  HubTeamApprovalDecisionRequest,
  HubTeamBudget,
  HubTeamConflictResolutionRequest,
  HubTeamRunState,
  HubUpdateDocumentRequest,
  PendingAgentTask,
  ProbeAttachmentResponse,
  StartAgentTeamRunRequest,
  TaskApprovalDecisionRequest,
  TeamApprovalDecisionRequest,
  TeamConflictResolutionRequest,
  TeamRunState,
  UpdateHubDocumentRequest,
} from './hubClientTeamTypes';

describe('hubClientTeamTypes (#767)', () => {
  it('keeps team run/profile DTO field contracts stable', () => {
    const summary: HubAgentRunEventSummary = {
      task_id: 't1',
      status: 'running',
      total_events: 2,
      last_event_seq: 2,
      event_type_counts: { step: 1, tool: 1 },
      tool_call_count: 1,
      step_count: 1,
      artifact_count: 0,
      approval_count: 0,
      pending_approvals: 0,
      decided_approvals: 0,
      input_tokens: 10,
      output_tokens: 20,
      output_bytes: 30,
    };
    const event: HubAgentRunEvent = {
      id: 'e1',
      task_id: 't1',
      session_id: 's1',
      agent_instance_id: 'ai1',
      event_seq: 1,
      event_type: 'step',
      payload: { text: 'hi' },
      created_at: 'now',
    };
    const route: HubCoordinatorRouteDecision = {
      action: 'continue',
      next_worker: 'executor',
      approved: true,
      accepted: true,
      subtask_id: 'tt-1',
      parent_task_id: 'tt-0',
      agent_id: 'm1',
      reason: 'queued subtask',
    };
    const team: HubAgentTeam = { id: 'team-1', name: 'Alpha' };
    const member: HubAgentTeamMember = {
      id: 'm1',
      team_id: 'team-1',
      role: 'executor',
    };
    const detail: HubAgentTeamDetail = { ...team, members: [member] };
    const run: HubAgentTeamRun = {
      id: 'run-1',
      team_id: 'team-1',
      mode: 'supervisor',
      status: 'pending_review',
    };
    const assignment: HubAgentTeamAssignment = {
      id: 'as-1',
      team_run_id: 'run-1',
      status: 'pending',
    };
    const task: HubAgentTeamTask = {
      id: 'tt-1',
      team_run_id: 'run-1',
      status: 'pending',
      input_refs: '{}',
    };
    const teamEvent: HubAgentTeamEvent = {
      id: 'te-1',
      team_run_id: 'run-1',
      seq: 1,
      type: 'task.started',
    };
    const budget: HubTeamBudget = {
      total_tokens_used: 100,
      token_limit: 1000,
      remaining_tokens: 900,
    };
    const state: HubTeamRunState = {
      run_id: 'run-1',
      team_id: 'team-1',
      status: 'running',
      budget,
      route_log: [route],
      dependencies: [{ task_id: 'tt-1', depends_on_task_id: 'tt-0', kind: 'parent_task' }],
      route_audit_log: [
        { status: 'accepted', action: 'delegate', subtask_id: 'tt-1', agent_id: 'm1' },
        { status: 'rejected', action: 'delegate', reason: 'task limit reached' },
      ],
      reviews: [
        {
          review_id: 'run-1-review-1',
          run_id: 'run-1',
          action: 'approve',
          comment: 'looks good',
          changes: [{ field: 'instructions', value: 'Do the other thing' }],
          created_at: 'now',
        },
      ],
    };

    expect(summary.task_id).toBe('t1');
    expect(event.event_type).toBe('step');
    expect(route.action).toBe('continue');
    expect(route.subtask_id).toBe('tt-1');
    expect(detail.members?.[0]?.role).toBe('executor');
    expect(run.status).toBe('pending_review');
    expect(run.mode).toBe('supervisor');
    expect(assignment.team_run_id).toBe('run-1');
    expect(task.status).toBe('pending');
    expect(task.input_refs).toBe('{}');
    expect(teamEvent.seq).toBe(1);
    expect(state.budget?.remaining_tokens).toBe(900);
    expect(state.dependencies?.[0]?.kind).toBe('parent_task');
    expect(state.route_audit_log?.[1]?.status).toBe('rejected');
    expect(state.reviews?.[0]?.action).toBe('approve');
  });

  it('keeps attachment / profile / document / approval DTO contracts stable', () => {
    const attachment: HubAttachmentRef = {
      id: 'att-1',
      hash: 'abc',
      size: 12,
      mime_type: 'text/plain',
    };
    const probe: HubProbeAttachmentResponse = {
      exists: true,
      attachment,
    };
    const profile: HubAgentProfile = {
      id: 'ap-1',
      name: 'Coder',
      runtime_id: 'codex',
    };
    const createProfile: HubCreateAgentProfileRequest = {
      name: 'Coder',
      runtime_id: 'codex',
    };
    const createTeam: HubCreateAgentTeamRequest = { name: 'Ops' };
    const startRun: HubStartAgentTeamRunRequest = {
      trigger_message: 'go',
      target_id: 'target-1',
    };
    const docItem: HubDocumentListItem = {
      id: 'd1',
      owner_id: 'u1',
      title: 'Spec',
      type: 'md',
      source: 'user',
      location: '/docs/spec.md',
      status: 'active',
      created_at: 'now',
      updated_at: 'now',
    };
    const docList: HubDocumentListResponse = {
      items: [docItem],
      page: { hasMore: false },
    };
    const createDoc: HubCreateDocumentRequest = { title: 'Spec' };
    const updateDoc: HubUpdateDocumentRequest = { status: 'archived' };
    const document: HubDocument = {
      ...docItem,
      source: 'user',
      status: 'active',
    };
    const streamOpts: HubAgentTaskStreamEventOptions = {
      runId: 'run-1',
      clientMsgId: 'c1',
    };
    const approval: HubAgentTaskApproval = {
      approval_id: 'apr-1',
      status: 'pending',
      tool_name: 'bash',
    };
    const approvalList: HubAgentTaskApprovalList = {
      task_id: 't1',
      approvals: [approval],
    };
    const artifact: HubAgentTaskArtifact = {
      path: 'src/a.ts',
      action: 'edit',
      can_apply: true,
    };
    const artifactList: HubAgentTaskArtifactList = {
      task_id: 't1',
      artifacts: [artifact],
    };
    const decision: HubTaskApprovalDecisionRequest = {
      decision: 'allow',
      reason: 'safe',
    };
    const teamDecision: HubTeamApprovalDecisionRequest = {
      decision: 'deny',
    };
    const conflict: HubTeamConflictResolutionRequest = {
      resolution: 'keep_a',
      path: 'src/a.ts',
    };
    const instance: HubAgentInstance = {
      id: 'ai-1',
      agent_type: 'codex',
      session_id: 's1',
      inviter_user_id: 'u1',
      display_name: 'Bot',
    };
    const pending: HubPendingAgentTask = {
      id: 'pt-1',
      agent_instance_id: 'ai-1',
      triggered_by_user_id: 'u1',
      trigger_message_id: 'm1',
      status: 'queued',
    };

    expect(probe.exists).toBe(true);
    expect(profile.runtime_id).toBe('codex');
    expect(createProfile.name).toBe('Coder');
    expect(createTeam.name).toBe('Ops');
    expect(startRun.trigger_message).toBe('go');
    expect(docList.items).toHaveLength(1);
    expect(createDoc.title).toBe('Spec');
    expect(updateDoc.status).toBe('archived');
    expect(document.location).toBe('/docs/spec.md');
    expect(streamOpts.runId).toBe('run-1');
    expect(approvalList.approvals[0]?.approval_id).toBe('apr-1');
    expect(artifactList.artifacts[0]?.can_apply).toBe(true);
    expect(decision.decision).toBe('allow');
    expect(teamDecision.decision).toBe('deny');
    expect(conflict.resolution).toBe('keep_a');
    expect(instance.display_name).toBe('Bot');
    expect(pending.status).toBe('queued');
  });

  it('keeps compatibility aliases assignable to Hub* types', () => {
    const team: AgentTeam = { id: 'team-1', name: 'A' };
    const hubTeam: HubAgentTeam = team;
    const detail: AgentTeamDetail = { id: 'team-1', name: 'A', members: [] };
    const hubDetail: HubAgentTeamDetail = detail;
    const run: AgentTeamRun = { id: 'r1', team_id: 'team-1', mode: 'compete', status: 'running' };
    const hubRun: HubAgentTeamRun = run;
    const route: CoordinatorRouteDecision = { action: 'stop' };
    const hubRoute: HubCoordinatorRouteDecision = route;
    const state: TeamRunState = { run_id: 'r1', team_id: 'team-1', status: 'done' };
    const hubState: HubTeamRunState = state;
    const profile: AgentProfile = { id: 'p1', name: 'P', runtime_id: 'codex' };
    const hubProfile: HubAgentProfile = profile;
    const createProfile: CreateAgentProfileRequest = {
      name: 'P',
      runtime_id: 'codex',
    };
    const hubCreateProfile: HubCreateAgentProfileRequest = createProfile;
    const createTeam: CreateAgentTeamRequest = { name: 'T' };
    const hubCreateTeam: HubCreateAgentTeamRequest = createTeam;
    const start: StartAgentTeamRunRequest = { trigger_message: 'hi' };
    const hubStart: HubStartAgentTeamRunRequest = start;
    const attachment: AttachmentRef = {
      id: 'a1',
      hash: 'h',
      size: 1,
      mime_type: 'text/plain',
    };
    const hubAttachment: HubAttachmentRef = attachment;
    const probe: ProbeAttachmentResponse = { exists: false };
    const hubProbe: HubProbeAttachmentResponse = probe;
    const createDoc: CreateHubDocumentRequest = { title: 'D' };
    const hubCreateDoc: HubCreateDocumentRequest = createDoc;
    const updateDoc: UpdateHubDocumentRequest = { title: 'D2' };
    const hubUpdateDoc: HubUpdateDocumentRequest = updateDoc;
    const approval: AgentTaskApproval = { approval_id: 'apr' };
    const hubApproval: HubAgentTaskApproval = approval;
    const artifact: AgentTaskArtifact = { path: 'x.ts' };
    const hubArtifact: HubAgentTaskArtifact = artifact;
    const decision: TaskApprovalDecisionRequest = { decision: 'allow' };
    const hubDecision: HubTaskApprovalDecisionRequest = decision;
    const teamDecision: TeamApprovalDecisionRequest = { decision: 'deny' };
    const hubTeamDecision: HubTeamApprovalDecisionRequest = teamDecision;
    const conflict: TeamConflictResolutionRequest = { resolution: 'keep_b' };
    const hubConflict: HubTeamConflictResolutionRequest = conflict;
    const instance: AgentInstance = {
      id: 'i1',
      agent_type: 'codex',
      session_id: 's1',
      inviter_user_id: 'u1',
      display_name: 'Bot',
    };
    const hubInstance: HubAgentInstance = instance;
    const pending: PendingAgentTask = {
      id: 'p1',
      agent_instance_id: 'i1',
      triggered_by_user_id: 'u1',
      trigger_message_id: 'm1',
      status: 'queued',
    };
    const hubPending: HubPendingAgentTask = pending;

    expect(hubTeam.id).toBe('team-1');
    expect(hubDetail.name).toBe('A');
    expect(hubRun.status).toBe('running');
    expect(hubRoute.action).toBe('stop');
    expect(hubState.run_id).toBe('r1');
    expect(hubProfile.runtime_id).toBe('codex');
    expect(hubCreateProfile.name).toBe('P');
    expect(hubCreateTeam.name).toBe('T');
    expect(hubStart.trigger_message).toBe('hi');
    expect(hubAttachment.size).toBe(1);
    expect(hubProbe.exists).toBe(false);
    expect(hubCreateDoc.title).toBe('D');
    expect(hubUpdateDoc.title).toBe('D2');
    expect(hubApproval.approval_id).toBe('apr');
    expect(hubArtifact.path).toBe('x.ts');
    expect(hubDecision.decision).toBe('allow');
    expect(hubTeamDecision.decision).toBe('deny');
    expect(hubConflict.resolution).toBe('keep_b');
    expect(hubInstance.agent_type).toBe('codex');
    expect(hubPending.id).toBe('p1');
  });
});
