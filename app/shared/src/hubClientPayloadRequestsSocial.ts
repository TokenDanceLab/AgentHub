/**
 * Hub client pure path+init request builders (domain companion).
 * Peel of hubClientPayloadRequests (#1101). Pure only; zero behavior change.
 */

import {
  buildForwardMessageBody,
  buildFriendRequestBody,
  buildMarkReadBody,
  buildMemberIdsBody,
  buildRemarkBody,
  buildSessionIdBody,
  buildTransferOwnerBody,
} from './hubClientPayloadBodies';
import {
  buildAcceptFriendRequestPath,
  buildBlockContactPath,
  buildContactRemarkPath,
  buildCreateGroupSessionPath,
  buildCreatePrivateSessionPath,
  buildDissolveSessionPath,
  buildEditMessagePath,
  buildForwardMessagePath,
  buildFriendRequestsPath,
  buildGetMessagesPath,
  buildLeaveSessionPath,
  buildMarkReadPath,
  buildPinMessagePath,
  buildRecallMessagePath,
  buildRejectFriendRequestPath,
  buildRemoveContactPath,
  buildRemoveSessionMemberPath,
  buildSessionAgentsPath,
  buildSessionInfoPath,
  buildSessionMembersPath,
  buildSessionPath,
  buildSessionSettingsPath,
  buildTransferSessionOwnerPath,
  buildUnblockContactPath,
} from './hubClientPayloadPaths';
import {
  buildDeleteInit,
  buildJsonDeleteInit,
  buildJsonPostInit,
  buildJsonPutInit,
  buildPostInit,
} from './hubClientPayloadRequestInits';

export function buildSendFriendRequest(friendId: string, message?: string): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildFriendRequestsPath(),
    init: buildJsonPostInit(buildFriendRequestBody(friendId, message)),
  };
}

export function buildUpdateContactRemarkRequest(
  friendUserId: string,
  remark: string,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildContactRemarkPath(friendUserId),
    init: buildJsonPutInit(buildRemarkBody(remark)),
  };
}

export function buildAddSessionMembersRequest(
  sessionId: string,
  memberIds: string[],
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildSessionMembersPath(sessionId),
    init: buildJsonPostInit(buildMemberIdsBody(memberIds)),
  };
}

export function buildTransferSessionOwnershipRequest(
  sessionId: string,
  newOwnerId: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildTransferSessionOwnerPath(sessionId),
    init: buildJsonPostInit(buildTransferOwnerBody(newOwnerId)),
  };
}

export function buildMarkReadRequest(
  sessionId: string,
  lastReadSeq: number,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildMarkReadPath(sessionId),
    init: buildJsonPostInit(buildMarkReadBody(lastReadSeq)),
  };
}

export function buildPinMessageRequest(
  messageId: string,
  sessionId: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildPinMessagePath(messageId),
    init: buildJsonPostInit(buildSessionIdBody(sessionId)),
  };
}

export function buildUnpinMessageRequest(
  messageId: string,
  sessionId: string,
): {
  path: string;
  init: { method: 'DELETE'; body: string };
} {
  return {
    path: buildPinMessagePath(messageId),
    init: buildJsonDeleteInit(buildSessionIdBody(sessionId)),
  };
}

export function buildForwardMessageRequest(
  messageId: string,
  targetSessionIds: string[],
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildForwardMessagePath(messageId),
    init: buildJsonPostInit(buildForwardMessageBody(targetSessionIds)),
  };
}

export function buildAddMessageReactionRequest(
  messageId: string,
  sessionId: string,
  reaction: { emoji: string },

export function buildRemoveMessageReactionRequest(
  messageId: string,
  sessionId: string,
  reaction: { emoji: string },

export function buildAcceptFriendRequest(requestId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildAcceptFriendRequestPath(requestId),
    init: buildPostInit(),
  };
}

export function buildRejectFriendRequest(requestId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildRejectFriendRequestPath(requestId),
    init: buildPostInit(),
  };
}

export function buildRemoveContactRequest(friendUserId: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildRemoveContactPath(friendUserId),
    init: buildDeleteInit(),
  };
}

export function buildCreatePrivateSessionRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildCreatePrivateSessionPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildCreateGroupSessionRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildCreateGroupSessionPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildRemoveSessionMemberRequest(
  sessionId: string,
  userId: string,
): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildRemoveSessionMemberPath(sessionId, userId),
    init: buildDeleteInit(),
  };
}

export function buildUpdateSessionInfoRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildSessionInfoPath(sessionId),
    init: buildJsonPutInit(body),
  };
}

export function buildUpdateSessionSettingsRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildSessionSettingsPath(sessionId),
    init: buildJsonPutInit(body),
  };
}

export function buildSendMessageRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildGetMessagesPath(sessionId),
    init: buildJsonPostInit(body),
  };
}

export function buildAddAgentToSessionRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildSessionAgentsPath(sessionId),
    init: buildJsonPostInit(body),
  };
}

export function buildEditMessageRequest(
  messageId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildEditMessagePath(messageId),
    init: buildJsonPutInit(body),
  };
}

export function buildBlockContactRequest(targetUserId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildBlockContactPath(targetUserId),
    init: buildPostInit(),
  };
}

export function buildUnblockContactRequest(targetUserId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildUnblockContactPath(targetUserId),
    init: buildPostInit(),
  };
}

export function buildLeaveSessionRequest(sessionId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildLeaveSessionPath(sessionId),
    init: buildPostInit(),
  };
}

export function buildDissolveSessionRequest(sessionId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildDissolveSessionPath(sessionId),
    init: buildPostInit(),
  };
}

export function buildDeleteSessionRequest(sessionId: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildSessionPath(sessionId),
    init: buildDeleteInit(),
  };
}

export function buildRecallMessageRequest(messageId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildRecallMessagePath(messageId),
    init: buildPostInit(),
  };
}

