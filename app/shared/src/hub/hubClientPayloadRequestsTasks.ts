/**
 * Hub client pure path+init request builders (domain companion).
 * Peel of hubClientPayloadRequests (#1101). Pure only; zero behavior change.
 */

import type {
  HubTriggerAgentTaskOptions,
} from './hubClientDomainTypes';
import type {
  HubAgentTaskStreamEventOptions,
} from './hubClientTeamTypes';
import {
  buildStreamTaskEventBody,
  buildTaskAckBody,
  buildTaskDoneBody,
  buildTaskFailBody,
  buildTaskStreamBody,
  buildTriggerAgentTaskBody,
} from './hubClientPayloadBodies';
import {
  buildAckTaskPath,
  buildAgentTasksPath,
  buildDecideTaskApprovalPath,
  buildDoneTaskPath,
  buildFailTaskPath,
  buildRegenerateAgentTaskPath,
  buildStreamTaskPath,
} from './hubClientPayloadPaths';
import {
  buildJsonPostInit,
  buildPostInit,
  buildPostWithOptionalJsonBody,
} from './hubClientPayloadRequestInits';

export function buildAckTaskRequest(
  taskId: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST' } | { method: 'POST'; body: string };
} {
  return {
    path: buildAckTaskPath(taskId),
    init: buildPostWithOptionalJsonBody(buildTaskAckBody(runId)),
  };
}

export function buildStreamTaskRequest(
  taskId: string,
  content: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildStreamTaskPath(taskId),
    init: buildJsonPostInit(buildTaskStreamBody(content, runId)),
  };
}

export function buildDoneTaskRequest(
  taskId: string,
  finalContent?: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDoneTaskPath(taskId),
    init: buildJsonPostInit(buildTaskDoneBody(finalContent, runId)),
  };
}

export function buildFailTaskRequest(
  taskId: string,
  error: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildFailTaskPath(taskId),
    init: buildJsonPostInit(buildTaskFailBody(error, runId)),
  };
}

export function buildTriggerAgentTaskRequest(
  triggerMessageId: string,
  options: HubTriggerAgentTaskOptions = {},
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTasksPath(),
    init: buildJsonPostInit(buildTriggerAgentTaskBody(triggerMessageId, options)),
  };
}

export function buildStreamTaskEventRequest(
  taskId: string,
  eventType: string,
  payload: unknown,
  options: HubAgentTaskStreamEventOptions = {},
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildStreamTaskPath(taskId),
    init: buildJsonPostInit(buildStreamTaskEventBody(eventType, payload, options)),
  };
}

export function buildRegenerateAgentTaskRequest(taskId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildRegenerateAgentTaskPath(taskId),
    init: buildPostInit(),
  };
}

export function buildDecideTaskApprovalRequest(
  taskId: string,
  approvalId: string,
  decision: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDecideTaskApprovalPath(taskId, approvalId),
    init: buildJsonPostInit(decision),
  };
}

