/**
 * Hub client pure path+init request builders (domain companion).
 * Peel of hubClientPayloadRequests (#1101). Pure only; zero behavior change.
 */

import {
  buildAttachmentFormData,
  buildPatchSettingsBody,
  buildProbeAttachmentBody,
} from './hubClientPayloadBodies';
import {
  buildAckRelayCommandPath,
  buildAttachmentsPath,
  buildCustomAgentPath,
  buildCustomAgentsPath,
  buildExecutionTargetPath,
  buildExecutionTargetsPath,
  buildPingExecutionTargetPath,
  buildProbeAttachmentPath,
  buildRelayCommandsPath,
  buildSendWorkspaceProjectThreadMessagePath,
  buildSettingsPath,
  buildWorkspaceProjectPath,
  buildWorkspaceProjectThreadsPath,
  buildWorkspaceProjectsPath,
} from './hubClientPayloadPaths';
import {
  buildDeleteInit,
  buildJsonPatchInit,
  buildJsonPostInit,
  buildJsonPutInit,
  buildPostInit,
} from './hubClientPayloadRequestInits';

export function buildPatchSettingsRequest(values: Record<string, string>): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildSettingsPath(),
    init: buildJsonPatchInit(buildPatchSettingsBody(values)),
  };
}

export function buildProbeAttachmentRequest(hash: string): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildProbeAttachmentPath(),
    init: buildJsonPostInit(buildProbeAttachmentBody(hash)),
  };
}

export function buildUploadAttachmentRequest(
  file: File,
  hash: string,
): {
  path: string;
  formData: FormData;
} {
  return {
    path: buildAttachmentsPath(),
    formData: buildAttachmentFormData(file, hash),
  };
}

// ── Composite path+init residual (#1055) ──────────────────────────────────────

export function buildCreateExecutionTargetRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildExecutionTargetsPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildUpdateExecutionTargetRequest(
  id: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildExecutionTargetPath(id),
    init: buildJsonPatchInit(body),
  };
}

export function buildPingExecutionTargetRequest(id: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildPingExecutionTargetPath(id),
    init: buildPostInit(),
  };
}

export function buildCreateRelayCommandRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildRelayCommandsPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildCreateCustomAgentRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildCustomAgentsPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildUpdateCustomAgentRequest(
  id: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildCustomAgentPath(id),
    init: buildJsonPutInit(body),
  };
}

export function buildCreateWorkspaceProjectRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildWorkspaceProjectsPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateWorkspaceProjectRequest(
  id: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildWorkspaceProjectPath(id),
    init: buildJsonPatchInit(data),
  };
}

export function buildCreateWorkspaceProjectThreadRequest(
  projectId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildWorkspaceProjectThreadsPath(projectId),
    init: buildJsonPostInit(data),
  };
}

export function buildSendWorkspaceProjectThreadMessageRequest(
  projectId: string,
  threadId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildSendWorkspaceProjectThreadMessagePath(projectId, threadId),
    init: buildJsonPostInit(data),
  };
}

export function buildDeleteExecutionTargetRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildExecutionTargetPath(id),
    init: buildDeleteInit(),
  };
}

export function buildAckRelayCommandRequest(id: string, deviceId: string): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAckRelayCommandPath(id),
    init: buildJsonPostInit({ device_id: deviceId }),
  };
}

export function buildDeleteCustomAgentRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildCustomAgentPath(id),
    init: buildDeleteInit(),
  };
}

