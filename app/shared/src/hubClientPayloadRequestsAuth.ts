/**
 * Hub client pure path+init request builders (domain companion).
 * Peel of hubClientPayloadRequests (#1101). Pure only; zero behavior change.
 */

import type {
  HubOidcAuthorizeRequest,
} from './hubClientDomainTypes';
import {
  buildOidcAuthorizeBody,
  buildRefreshBody,
} from './hubClientPayloadBodies';
import {
  buildLoginPath,
  buildLogoutPath,
  buildOidcAuthorizePath,
  buildOidcCallbackPath,
  buildRefreshPath,
  buildRegisterPath,
  buildUpdateProfilePath,
} from './hubClientPayloadPaths';
import {
  buildJsonPostInit,
  buildJsonPutInit,
  buildPostInit,
} from './hubClientPayloadRequestInits';

export function buildRefreshRequest(refreshToken: string): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildRefreshPath(),
    init: buildJsonPostInit(buildRefreshBody(refreshToken)),
  };
}

export function buildOidcAuthorizeRequest(body: HubOidcAuthorizeRequest): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildOidcAuthorizePath(),
    init: buildJsonPostInit(buildOidcAuthorizeBody(body)),
  };
}

export function buildRegisterRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildRegisterPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildLoginRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildLoginPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildUpdateProfileRequest(body: unknown): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildUpdateProfilePath(),
    init: buildJsonPutInit(body),
  };
}

export function buildOidcCallbackPathInit(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildOidcCallbackPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildLogoutRequest(): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildLogoutPath(),
    init: buildPostInit(),
  };
}

