/**
 * Hub client pure path+init request builders (domain companion).
 * Peel of hubClientPayloadRequests (#1101). Pure only; zero behavior change.
 */

import {
  buildAgentProfilePath,
  buildAgentProfilesPath,
  buildAgentTeamMembersPath,
  buildAgentTeamPath,
  buildAgentTeamRunsPath,
  buildAgentTeamsPath,
  buildDecideTeamApprovalPath,
  buildDocumentPath,
  buildDocumentsPath,
  buildPostTeamRouteDecisionPath,
  buildRemoveAgentTeamMemberPath,
  buildResolveTeamConflictPath,
} from './hubClientPayloadPaths';
import {
  buildDeleteInit,
  buildJsonPatchInit,
  buildJsonPostInit,
  buildJsonPutInit,
} from './hubClientPayloadRequestInits';

export function buildCreateAgentTeamRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTeamsPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateAgentTeamRequest(
  teamId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildAgentTeamPath(teamId),
    init: buildJsonPutInit(data),
  };
}

export function buildAddAgentTeamMemberRequest(
  teamId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTeamMembersPath(teamId),
    init: buildJsonPostInit(data),
  };
}

export function buildStartTeamRunRequest(
  teamId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTeamRunsPath(teamId),
    init: buildJsonPostInit(data),
  };
}

export function buildDecideTeamApprovalRequest(
  teamId: string,
  runId: string,
  approvalId: string,
  decision: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDecideTeamApprovalPath(teamId, runId, approvalId),
    init: buildJsonPostInit(decision),
  };
}

export function buildResolveTeamConflictRequest(
  teamId: string,
  runId: string,
  conflictId: string,
  resolution: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildResolveTeamConflictPath(teamId, runId, conflictId),
    init: buildJsonPostInit(resolution),
  };
}

export function buildCreateAgentProfileRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentProfilesPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateAgentProfileRequest(
  id: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildAgentProfilePath(id),
    init: buildJsonPatchInit(data),
  };
}

export function buildCreateDocumentRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDocumentsPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateDocumentRequest(
  id: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildDocumentPath(id),
    init: buildJsonPatchInit(data),
  };
}

export function buildRemoveAgentTeamMemberRequest(
  teamId: string,
  memberId: string,
): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildRemoveAgentTeamMemberPath(teamId, memberId),
    init: buildDeleteInit(),
  };
}

export function buildPostTeamRouteDecisionRequest(
  teamId: string,
  runId: string,
  decision: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildPostTeamRouteDecisionPath(teamId, runId),
    init: buildJsonPostInit(decision),
  };
}

export function buildDeleteAgentTeamRequest(teamId: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildAgentTeamPath(teamId),
    init: buildDeleteInit(),
  };
}

export function buildDeleteAgentProfileRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildAgentProfilePath(id),
    init: buildDeleteInit(),
  };
}

export function buildDeleteDocumentRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildDocumentPath(id),
    init: buildDeleteInit(),
  };
}

