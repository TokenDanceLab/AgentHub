/**
 * Chatview fixtures: Builder DM transcript.
 * Peel companion of chatviewFixtures (#1132). Pure only; zero behavior change.
 */

import type { EvidenceRefStatus, TranscriptBlock } from '../transcript/types'
import { B, T, U } from './chatviewFixturesHelpers'

// ═══════════════════════════════════════════════════════════════════════
// Builder DM — long realistic ReAct: "Refactor the API client layer to use generics"
// ~55 blocks: user msg → plan → run_session → think×3 → tool×10 → file×5 → sub×2 → approval → deploy → context
// ═══════════════════════════════════════════════════════════════════════

export const chatviewBuilderTranscript: TranscriptBlock[] = [
  /* ── Attachment: Existing client layer survey ── */
  {
    id: 'batt1', kind: 'attachment', createdAt: T(0.5),
    author: U('alice'),
    attachmentRef: {
      id: 'att_3c6d8f1a',
      name: 'api-client-survey.txt',
      original_name: 'api-client-survey.txt',
      size: 2789,
      mime_type: 'text/plain',
      hash: 'sha256:12ab34cd56ef7890',
      url: '/client/attachments/att_3c6d8f1a',
      metadata: '{}',
      created_at: T(0),
    },
    contentType: 'file',
  },

  /* ── User opens with the feature request ── */
  { id: 'bu1', kind: 'text', createdAt: T(0), author: U('alice'), text: 'Refactor the API client layer to use generics. Right now every endpoint has its own fetch wrapper with duplicated response parsing, error handling, and type casting. I want a single typed client like createApiClient<MySchema>() that gives full type safety on request params, response body, and error shapes.' },

  /* ── Agent plan text ── */
  {
    id: 'baplan', kind: 'text', createdAt: T(1), author: B('builder'),
    text: 'Plan:\n1. Audit all existing fetch wrappers across api/ directory\n2. Design the generic endpoint type (request params, body, response, error shape per endpoint)\n3. Implement createApiClient<TEndpoints>(baseUrl, options) factory function\n4. Migrate two endpoint files as proof of concept\n5. Run linter, type-check, and integration suite\n6. Await approval before applying changes',
    displayTitle: 'Execution plan',
    displayDetail: 'Audit all fetch wrappers, design generic endpoint types, implement createApiClient, migrate two endpoint files as proof of concept.',
  },

  /* ── Run session card ── */
  {
    id: 'brun1', kind: 'run_session', createdAt: T(1.5), author: B('builder'),
    title: 'Refactor API client layer',
    status: 'running',
    meta: 'Generic typed client',
    agentLabel: 'Builder',
    runtimeLabel: 'Claude Sonnet 4',
  },

  /* ── Goal registration: long refactor states its objective (#1998, UX F8).
       Shape mirrors the real transcript projection: tool_call block with a
       bounded scalar input projection (objective). ── */
  {
    id: 'bgoal1', kind: 'tool_call', createdAt: T(1.6), author: B('builder'),
    callId: 'call-goal-create',
    toolName: 'create_goal',
    status: 'completed',
    input: { objective: 'Refactor the API client layer into a single typed createApiClient factory and migrate every endpoint wrapper' },
  },
  { id: 'bgoal1r', kind: 'tool_result', createdAt: T(1.7), author: B('builder'), callId: 'call-goal-create', toolName: 'create_goal', status: 'completed', summary: 'Goal registered: refactor the API client layer into a single typed client' },

  /* ── Think 1: Survey scope ── */
  {
    id: 'bth1', kind: 'thinking', createdAt: T(2), author: B('builder'),
    content: 'First step: survey the current client layer. Likely locations are src/api/client.ts, src/api/endpoints/, src/lib/fetch-wrapper.ts. Each endpoint currently has its own thin wrapper with duplicated response.json() parsing, duplicated error shape normalization, and duplicated type cast via `as EntityType`. The goal is a single generic function createApiClient<Schema>() that takes a typed endpoints map and returns fully-typed methods: client.users.list(), client.projects.create(body). Start by reading the core files and grep for fetch usage patterns.',
    isThinking: false,
  },

  /* ── Tool calls: Read core files (5 total across 5 files) ── */
  { id: 'bto1', kind: 'tool_call', createdAt: T(3), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr1', kind: 'tool_result', createdAt: T(4), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/api/client.ts · 312 lines · 17 separate fetch wrapper functions, each with own response.json() + error handling + type cast' },
  { id: 'bto2', kind: 'tool_call', createdAt: T(5), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr2', kind: 'tool_result', createdAt: T(6), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/api/endpoints/users.ts · 143 lines · getUsers, getUserById, createUser, updateUser, deleteUser — all duplicate the same fetch/parse/error pattern' },
  { id: 'bto3', kind: 'tool_call', createdAt: T(7), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr3', kind: 'tool_result', createdAt: T(8), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/api/endpoints/projects.ts · 112 lines · same duplication pattern — getProjects, getProjectById, createProject, updateProject, deleteProject' },
  { id: 'bto4', kind: 'tool_call', createdAt: T(9), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr4', kind: 'tool_result', createdAt: T(10), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/api/endpoints/tasks.ts · 95 lines · getTasks, getTaskById, createTask, updateTask, deleteTask — same structure' },
  { id: 'bto5', kind: 'tool_call', createdAt: T(11), author: B('builder'), toolName: 'Grep', status: 'running' },
  { id: 'btr5', kind: 'tool_result', createdAt: T(12), author: B('builder'), toolName: 'Grep', status: 'completed', summary: 'src/api/ → "response.json|.catch|as Promise|fetch(" · 53 matches · 8 endpoint files · identical error-handling pattern repeated everywhere' },

  /* ── Think 2: Analyze patterns, design types ── */
  {
    id: 'bth2', kind: 'thinking', createdAt: T(13), author: B('builder'),
    content: 'Survey complete. 8 endpoint files, 17 wrapper functions in client.ts, 53 duplicated fetch/parse/error patterns. Common pattern: each function (1) constructs URL with string interpolation, (2) calls fetch with method + headers + optional body, (3) checks response.ok, (4) does response.json(), (5) type-casts via `as`. The generic solution: define EndpointDef = { method, path, searchParams?, body?, response, error }, then a factory loops over an endpoints map and builds typed methods with full type inference on params, body, and return type. This eliminates all 53 duplication sites and provides compile-time safety. Next: implement types.ts, create-client.ts, and migrate two endpoint files as proof.',
    isThinking: false,
  },

  /* ── File changes (5 total) ── */
  {
    id: 'bf1', kind: 'file_change', createdAt: T(14), author: B('builder'),
    path: 'src/api/types.ts', action: 'created', additions: 32,
  },
  {
    id: 'bf2', kind: 'file_change', createdAt: T(15), author: B('builder'),
    path: 'src/api/create-client.ts', action: 'created', additions: 78,
  },
  {
    id: 'bf3', kind: 'file_change', createdAt: T(16), author: B('builder'),
    path: 'src/api/endpoints/users.ts', action: 'modified', additions: 12, deletions: 45,
  },
  {
    id: 'bf4', kind: 'file_change', createdAt: T(17), author: B('builder'),
    path: 'src/api/endpoints/projects.ts', action: 'modified', additions: 10, deletions: 38,
  },
  {
    id: 'bf5', kind: 'file_change', createdAt: T(18), author: B('builder'),
    path: 'src/api/index.ts', action: 'modified', additions: 6, deletions: 3,
  },

  /* ── Diff 1: Generic type definitions ── */
  {
    id: 'bdiff1', kind: 'diff', createdAt: T(18.3),
    author: B('builder'),
    title: 'src/api/types.ts — Generic endpoint type definitions',
    files: ['src/api/types.ts'],
    additions: 32, deletions: 0,
    patch: '@@ -0,0 +1,32 @@\n+export interface EndpointDef {\n+  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";\n+  path: string;\n+  searchParams?: Record<string, string>;\n+  body?: unknown;\n+  response: unknown;\n+  error: { status: number; message: string };\n+}\n+\n+export type EndpointMap = Record<string, EndpointDef>;\n+\n+export type ClientMethod<T extends EndpointDef> = (\n+  params?: T extends { searchParams: infer P } ? P : never,\n+  body?: T extends { body: infer B } ? B : never\n+) => Promise<T["response"]>;\n+\n+export type ApiClient<T extends EndpointMap> = {\n+  [K in keyof T]: ClientMethod<T[K]>;\n+};\n',
    lines: [
      { type: 'add', content: 'export interface EndpointDef {' },
      { type: 'add', content: '  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";' },
      { type: 'add', content: '  path: string;' },
      { type: 'add', content: '  searchParams?: Record<string, string>;' },
      { type: 'add', content: '  body?: unknown;' },
      { type: 'add', content: '  response: unknown;' },
      { type: 'add', content: '  error: { status: number; message: string };' },
      { type: 'add', content: '}' },
      { type: 'add', content: '' },
      { type: 'add', content: 'export type EndpointMap = Record<string, EndpointDef>;' },
      { type: 'add', content: '' },
      { type: 'add', content: 'export type ClientMethod<T extends EndpointDef> = (' },
      { type: 'add', content: '  params?: T extends { searchParams: infer P } ? P : never,' },
      { type: 'add', content: '  body?: T extends { body: infer B } ? B : never' },
      { type: 'add', content: ') => Promise<T["response"]>;' },
      { type: 'add', content: '' },
      { type: 'add', content: 'export type ApiClient<T extends EndpointMap> = {' },
      { type: 'add', content: '  [K in keyof T]: ClientMethod<T[K]>;' },
      { type: 'add', content: '};' },
    ],
  },

  /* ── Diff 2: Generic client factory ── */
  {
    id: 'bdiff2', kind: 'diff', createdAt: T(18.6),
    author: B('builder'),
    title: 'src/api/create-client.ts — Generic client factory',
    files: ['src/api/create-client.ts'],
    additions: 78, deletions: 0,
    patch: '@@ -0,0 +1,78 @@\n+import type { EndpointMap, ApiClient } from "./types";\n+\n+export function createApiClient<T extends EndpointMap>(\n+  endpoints: T,\n+  baseUrl: string,\n+  options?: RequestInit\n+): ApiClient<T> {\n+  const client = {} as Record<string, Function>;\n+\n+  for (const [name, def] of Object.entries(endpoints)) {\n+    client[name] = async (params?: any, body?: any) => {\n+      let url = `${baseUrl}${def.path}`;\n+      if (params) {\n+        const sp = new URLSearchParams(params);\n+        url += `?${sp.toString()}`;\n+      }\n+      const res = await fetch(url, {\n+        method: def.method,\n+        headers: { "Content-Type": "application/json", ...options?.headers },\n+        body: body ? JSON.stringify(body) : undefined,\n+      });\n+      if (!res.ok) {\n+        const err = await res.json().catch(() => ({}));\n+        throw Object.assign(new Error(err.message ?? "Request failed"), {\n+          status: res.status,\n+          body: err,\n+        });\n+      }\n+      return res.json();\n+    };\n+  }\n+\n+  return client as ApiClient<T>;\n+}\n',
    lines: [
      { type: 'add', content: 'import type { EndpointMap, ApiClient } from "./types";' },
      { type: 'add', content: '' },
      { type: 'add', content: 'export function createApiClient<T extends EndpointMap>(' },
      { type: 'add', content: '  endpoints: T,' },
      { type: 'add', content: '  baseUrl: string,' },
      { type: 'add', content: '  options?: RequestInit' },
      { type: 'add', content: '): ApiClient<T> {' },
      { type: 'add', content: '  const client = {} as Record<string, Function>;' },
      { type: 'add', content: '' },
      { type: 'add', content: '  for (const [name, def] of Object.entries(endpoints)) {' },
      { type: 'add', content: '    client[name] = async (params?: any, body?: any) => {' },
      { type: 'add', content: '      let url = `${baseUrl}${def.path}`;' },
      { type: 'add', content: '      if (params) {' },
      { type: 'add', content: '        const sp = new URLSearchParams(params);' },
      { type: 'add', content: '        url += `?${sp.toString()}`;' },
      { type: 'add', content: '      }' },
      { type: 'add', content: '      const res = await fetch(url, {' },
      { type: 'add', content: '        method: def.method,' },
      { type: 'add', content: '        headers: { "Content-Type": "application/json", ...options?.headers },' },
      { type: 'add', content: '        body: body ? JSON.stringify(body) : undefined,' },
      { type: 'add', content: '      });' },
      { type: 'add', content: '      if (!res.ok) {' },
      { type: 'add', content: '        const err = await res.json().catch(() => ({}));' },
      { type: 'add', content: '        throw Object.assign(new Error(err.message ?? "Request failed"), {' },
      { type: 'add', content: '          status: res.status,' },
      { type: 'add', content: '          body: err,' },
      { type: 'add', content: '        });' },
      { type: 'add', content: '      }' },
      { type: 'add', content: '      return res.json();' },
      { type: 'add', content: '    };' },
      { type: 'add', content: '  }' },
      { type: 'add', content: '' },
      { type: 'add', content: '  return client as ApiClient<T>;' },
      { type: 'add', content: '}' },
    ],
  },

  /* ── Additional tool calls: Read call-site files ── */
  { id: 'bto6', kind: 'tool_call', createdAt: T(18.7), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr6', kind: 'tool_result', createdAt: T(18.8), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/components/UserTable.tsx · 145 lines · imports getUsers, createUser from endpoints/users · uses named function imports' },
  { id: 'bto7', kind: 'tool_call', createdAt: T(18.9), author: B('builder'), toolName: 'Grep', status: 'running' },
  { id: 'btr7', kind: 'tool_result', createdAt: T(19.0), author: B('builder'), toolName: 'Grep', status: 'completed', summary: 'src/ → "import.*from.*api/endpoints" · 31 import sites · 9 files · all importing named functions, will need migration to client.method() style' },

  /* ── Think 3: Wire up endpoints, assess remaining scope ── */
  {
    id: 'bth3', kind: 'thinking', createdAt: T(19), author: B('builder'),
    content: 'Core implementation done. The generic client now handles request construction, body serialization, error normalization, and response parsing in one place. Two endpoint files migrated as proof: users.ts went from 143 lines to 110 (net -33), projects.ts from 112 to 84 (net -28). The old client.ts still holds 6 more endpoint wrappers that can be migrated in a follow-up — they follow the identical pattern and the type system already covers them. Next: run linter and type-check via subagents to verify correctness.',
    isThinking: false,
  },

  /* ── Diff 3: Migrated users endpoint ── */
  {
    id: 'bdiff3', kind: 'diff', createdAt: T(19.3),
    author: B('builder'),
    title: 'src/api/endpoints/users.ts — Migrated to generic client',
    files: ['src/api/endpoints/users.ts'],
    additions: 12, deletions: 45,
    patch: '@@ -1,45 +1,12 @@\n-export async function getUsers(page = 1, limit = 20) {\n-  const res = await fetch(`/api/users?page=${page}&limit=${limit}`);\n-  if (!res.ok) throw new Error("Failed to fetch users");\n-  return res.json() as Promise<UserListResponse>;\n-}\n-\n-export async function getUserById(id: string) {\n-  const res = await fetch(`/api/users/${id}`);\n-  if (!res.ok) throw new Error("Failed to fetch user");\n-  return res.json() as Promise<User>;\n-}\n-\n-export async function createUser(body: CreateUserBody) {\n-  const res = await fetch("/api/users", { method: "POST", body: JSON.stringify(body) });\n-  if (!res.ok) throw new Error("Failed to create user");\n-  return res.json() as Promise<User>;\n-}\n-\n-export async function updateUser(id: string, body: UpdateUserBody) {\n-  const res = await fetch(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });\n-  if (!res.ok) throw new Error("Failed to update user");\n-  return res.json() as Promise<User>;\n-}\n-\n-export async function deleteUser(id: string) {\n-  const res = await fetch(`/api/users/${id}`, { method: "DELETE" });\n-  if (!res.ok) throw new Error("Failed to delete user");\n-}\n+import { createApiClient } from "../create-client";\n+\n+export const usersApi = createApiClient({\n+  list:    { method: "GET",    path: "/api/users",      response: {} as UserListResponse },\n+  getById: { method: "GET",    path: "/api/users/:id",  response: {} as User },\n+  create:  { method: "POST",   path: "/api/users",      body: {} as CreateUserBody, response: {} as User },\n+  update:  { method: "PATCH",  path: "/api/users/:id",  body: {} as UpdateUserBody, response: {} as User },\n+  delete:  { method: "DELETE", path: "/api/users/:id",  response: {} as void },\n+}, "/api");\n',
    lines: [
      { type: 'del', content: 'export async function getUsers(page = 1, limit = 20) {' },
      { type: 'del', content: '  const res = await fetch(`/api/users?page=${page}&limit=${limit}`);' },
      { type: 'del', content: '  if (!res.ok) throw new Error("Failed to fetch users");' },
      { type: 'del', content: '  return res.json() as Promise<UserListResponse>;' },
      { type: 'del', content: '}' },
      { type: 'del', content: '... 4 more duplicated wrappers ...' },
      { type: 'add', content: 'import { createApiClient } from "../create-client";' },
      { type: 'add', content: '' },
      { type: 'add', content: 'export const usersApi = createApiClient({' },
      { type: 'add', content: '  list:    { method: "GET",    path: "/api/users",      response: {} as UserListResponse },' },
      { type: 'add', content: '  getById: { method: "GET",    path: "/api/users/:id",  response: {} as User },' },
      { type: 'add', content: '  create:  { method: "POST",   path: "/api/users",      body: {} as CreateUserBody, response: {} as User },' },
      { type: 'add', content: '  update:  { method: "PATCH",  path: "/api/users/:id",  body: {} as UpdateUserBody, response: {} as User },' },
      { type: 'add', content: '  delete:  { method: "DELETE", path: "/api/users/:id",  response: {} as void },' },
      { type: 'add', content: '}, "/api");' },
    ],
  },

  /* ── Diff 4: Migrated projects endpoint ── */
  {
    id: 'bdiff4', kind: 'diff', createdAt: T(19.4),
    author: B('builder'),
    title: 'src/api/endpoints/projects.ts — Migrated to generic client',
    files: ['src/api/endpoints/projects.ts'],
    additions: 10, deletions: 38,
    patch: '@@ -1,38 +1,10 @@\n-export async function getProjects() {\n-  const res = await fetch("/api/projects");\n-  if (!res.ok) throw new Error("Failed to fetch projects");\n-  return res.json() as Promise<ProjectListResponse>;\n-}\n-\n-export async function getProjectById(id: string) {\n-  const res = await fetch(`/api/projects/${id}`);\n-  if (!res.ok) throw new Error("Failed to fetch project");\n-  return res.json() as Promise<Project>;\n-}\n-\n-export async function createProject(body: CreateProjectBody) {\n-  const res = await fetch("/api/projects", { method: "POST", body: JSON.stringify(body) });\n-  if (!res.ok) throw new Error("Failed to create project");\n-  return res.json() as Promise<Project>;\n-}\n-\n-export async function updateProject(id: string, body: UpdateProjectBody) {\n-  const res = await fetch(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) });\n-  if (!res.ok) throw new Error("Failed to update project");\n-  return res.json() as Promise<Project>;\n-}\n+import { createApiClient } from "../create-client";\n+\n+export const projectsApi = createApiClient({\n+  list:    { method: "GET",    path: "/api/projects",      response: {} as ProjectListResponse },\n+  getById: { method: "GET",    path: "/api/projects/:id",  response: {} as Project },\n+  create:  { method: "POST",   path: "/api/projects",      body: {} as CreateProjectBody, response: {} as Project },\n+  update:  { method: "PATCH",  path: "/api/projects/:id",  body: {} as UpdateProjectBody, response: {} as Project },\n+}, "/api");\n',
    lines: [
      { type: 'del', content: 'export async function getProjects() {' },
      { type: 'del', content: '  const res = await fetch("/api/projects");' },
      { type: 'del', content: '  if (!res.ok) throw new Error("Failed to fetch projects");' },
      { type: 'del', content: '  return res.json() as Promise<ProjectListResponse>;' },
      { type: 'del', content: '}' },
      { type: 'del', content: '... 3 more duplicated wrappers ...' },
      { type: 'add', content: 'import { createApiClient } from "../create-client";' },
      { type: 'add', content: '' },
      { type: 'add', content: 'export const projectsApi = createApiClient({' },
      { type: 'add', content: '  list:    { method: "GET",    path: "/api/projects",      response: {} as ProjectListResponse },' },
      { type: 'add', content: '  getById: { method: "GET",    path: "/api/projects/:id",  response: {} as Project },' },
      { type: 'add', content: '  create:  { method: "POST",   path: "/api/projects",      body: {} as CreateProjectBody, response: {} as Project },' },
      { type: 'add', content: '  update:  { method: "PATCH",  path: "/api/projects/:id",  body: {} as UpdateProjectBody, response: {} as Project },' },
      { type: 'add', content: '}, "/api");' },
    ],
  },

  /* ── Think 4: Migration call-site impact ── */
  {
    id: 'bth4', kind: 'thinking', createdAt: T(19.5), author: B('builder'),
    content: 'Added a Grep for import sites: 31 files import from api/endpoints directly. These will need updating from named-function imports (import { getUsers } from "...") to client-based calls (usersApi.list()). That is a separate migration pass — for this PR, the proof of concept with two migrated endpoint files is sufficient to validate the approach. The old client.ts can be left intact until all 8 endpoint files are migrated; it still exports the same functions as before. No breaking changes to existing call sites yet.',
    isThinking: false,
  },

  /* ── Diff 5: index.ts re-export update ── */
  {
    id: 'bdiff5', kind: 'diff', createdAt: T(19.6),
    author: B('builder'),
    title: 'src/api/index.ts — Re-export generic client + migrated endpoints',
    files: ['src/api/index.ts'],
    additions: 6, deletions: 3,
    patch: '@@ -1,3 +1,6 @@\n-export { getUsers, getUserById, createUser, updateUser, deleteUser } from "./endpoints/users";\n-export { getProjects, getProjectById, createProject, updateProject } from "./endpoints/projects";\n+export { createApiClient } from "./create-client";\n+export type { EndpointDef, EndpointMap, ApiClient } from "./types";\n+export { usersApi } from "./endpoints/users";\n+export { projectsApi } from "./endpoints/projects";\n+// Legacy exports preserved for backward compatibility\n+export { getUsers, getProjects } from "./client";\n',
    lines: [
      { type: 'del', content: 'export { getUsers, getUserById, createUser, updateUser, deleteUser } from "./endpoints/users";' },
      { type: 'del', content: 'export { getProjects, getProjectById, createProject, updateProject } from "./endpoints/projects";' },
      { type: 'add', content: 'export { createApiClient } from "./create-client";' },
      { type: 'add', content: 'export type { EndpointDef, EndpointMap, ApiClient } from "./types";' },
      { type: 'add', content: 'export { usersApi } from "./endpoints/users";' },
      { type: 'add', content: 'export { projectsApi } from "./endpoints/projects";' },
      { type: 'add', content: '// Legacy exports preserved for backward compatibility' },
      { type: 'add', content: 'export { getUsers, getProjects } from "./client";' },
    ],
  },

  /* ── Additional tool call: type-check proofs ── */
  { id: 'bto8', kind: 'tool_call', createdAt: T(19.7), author: B('builder'), toolName: 'TypeCheck', status: 'running' },
  { id: 'btr8', kind: 'tool_result', createdAt: T(19.8), author: B('builder'), toolName: 'TypeCheck', status: 'completed', summary: 'tsc --noEmit --strict · 0 errors · generic type inference resolves correctly for all endpoint shapes (GET no body required, POST body typed, DELETE void)' },

  /* ── Think 5: Pre-subagent assessment ── */
  {
    id: 'bth5', kind: 'thinking', createdAt: T(19.9), author: B('builder'),
    content: 'All implementation files written, diffs generated for reviewers, type-check passed. The migration approach is validated: users.ts and projects.ts now use the generic client, re-exports updated in index.ts, legacy client.ts preserved for backward compatibility. Ready to run subagent checks before requesting approval.',
    isThinking: false,
  },

  /* ── Additional tool calls: tasks endpoint + error scenarios ── */
  { id: 'bto9', kind: 'tool_call', createdAt: T(19.91), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr9', kind: 'tool_result', createdAt: T(19.92), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/api/endpoints/tasks.ts · 95 lines · getTasks, getTaskById, createTask, updateTask, deleteTask — exact same pattern, ready for follow-up migration' },
  { id: 'bto10', kind: 'tool_call', createdAt: T(19.93), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr10', kind: 'tool_result', createdAt: T(19.94), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/api/endpoints/billing.ts · 78 lines · getInvoices, getInvoiceById, createPayment — same fetch-wrapper pattern, 3 more wrappers to migrate in follow-up' },

  /* ── Diff 6: billing endpoint survey (not yet migrated, documented for follow-up) ── */
  {
    id: 'bdiff6', kind: 'diff', createdAt: T(19.95),
    author: B('builder'),
    title: 'src/api/endpoints/billing.ts — Identified for follow-up migration',
    files: ['src/api/endpoints/billing.ts'],
    additions: 0, deletions: 0,
    patch: '@@ -1,78 +1,78 @@\n // Same fetch-wrapper pattern as users and projects\n // getInvoices, getInvoiceById, createPayment\n // Will be migrated in a follow-up PR — type system already covers all shapes\n export async function getInvoices() { /* ... */ }\n export async function getInvoiceById(id: string) { /* ... */ }\n export async function createPayment(body: CreatePaymentBody) { /* ... */ }\n',
    lines: [
      { type: 'ctx', content: '// Same fetch-wrapper pattern as users and projects' },
      { type: 'ctx', content: '// getInvoices, getInvoiceById, createPayment' },
      { type: 'ctx', content: '// Will be migrated in a follow-up PR — type system already covers all shapes' },
      { type: 'ctx', content: 'export async function getInvoices() { /* ... */ }' },
      { type: 'ctx', content: 'export async function getInvoiceById(id: string) { /* ... */ }' },
      { type: 'ctx', content: 'export async function createPayment(body: CreatePaymentBody) { /* ... */ }' },
    ],
  },

  /* ── Subagents (2 total) ── */
  {
    id: 'bsub1', kind: 'subagent', createdAt: T(20), author: B('builder'),
    title: 'Linter check', worker: 'Linter', status: 'completed',
    summary: '0 errors, 0 warnings · eslint + prettier + tsc --noEmit all passed across 5 changed files',
  },
  {
    id: 'bsub2', kind: 'subagent', createdAt: T(21), author: B('builder'),
    title: 'TypeAuditor — verify generic type inference', worker: 'TypeAuditor', status: 'completed',
    summary: 'Type audit passed: EndpointDef conditional types resolve correctly for GET (no body param required), POST/PUT (body required, typed), void on DELETE. No \'as\' casts remain in migrated call sites.',
  },

  /* ── Go-ahead bubble ── */
  {
    id: 'ba2', kind: 'text', createdAt: T(22), author: B('builder'),
    text: 'Changes ready. Two new files (src/api/types.ts, src/api/create-client.ts), three modified files (users.ts -45/+12, projects.ts -38/+10, index.ts re-export). Linter and type auditor both passed. The generic client eliminates 53 duplicated fetch wrappers across 8 endpoint files. Awaiting approval to write changes.',
    displayTitle: 'Changes ready for review',
    displayDetail: 'Two new files, three modified files. Linter and type auditor both passed. 53 duplicated fetch wrappers eliminated.',
  },

  /* ── Think 6: Final pre-approval sanity check ── */
  {
    id: 'bth6', kind: 'thinking', createdAt: T(22.5), author: B('builder'),
    content: 'Final sanity check before requesting approval. (1) Two new files: types.ts (32 lines) and create-client.ts (78 lines) — clean, no external dependencies beyond fetch. (2) Three modified files: users.ts (-45/+12), projects.ts (-38/+10), index.ts (-3/+6). Net code reduction: 127 lines removed, 38 lines added across all changes. (3) All type checks pass in strict mode. (4) Backward compatibility maintained: legacy client.ts still exports old named functions. (5) 31 call sites need migration in follow-up but no breakage. Safe to proceed to approval.',
    isThinking: false,
  },

  /* ── Approval → user approves → deploy ── */
  {
    id: 'bap1', kind: 'approval', createdAt: T(23), author: B('builder'),
    title: 'Write 5 files (2 new, 3 modified)', status: 'waiting' as unknown as EvidenceRefStatus,
    reason: 'Builder requests creation of src/api/types.ts, src/api/create-client.ts and modification of 3 existing files. All type checks and lint pass. Confirmation required to proceed.',
  },
  { id: 'bu2', kind: 'text', createdAt: T(24), author: U('alice'), text: 'Looks good, approved. Go ahead and write the files.' },
  { id: 'ba3', kind: 'text', createdAt: T(25), author: B('builder'), text: 'Approval granted. Writing files and deploying preview.' },

  /* ── Deploy ── */
  {
    id: 'bdep1', kind: 'deploy', createdAt: T(26), author: B('builder'),
    runId: 'run_builder_001', status: 'deployed', url: 'about:blank',
  },

  /* ── Context usage ── */
  {
    id: 'bctx1', kind: 'context_usage', createdAt: T(27), author: B('builder'),
    inputTokens: 92000, outputTokens: 3800, usagePercent: 48,
    contextLimit: 200000, modelLabel: 'Claude Sonnet 4',
    cachePercent: 22, cost: '$1.14',
  },

  /* ── Final bubble ── */
  { id: 'ba4', kind: 'text', createdAt: T(28), author: B('builder'), text: 'All done. Generic API client deployed: src/api/types.ts (32 lines), src/api/create-client.ts (78 lines). users.ts (-45/+12 lines) and projects.ts (-38/+10 lines) migrated as proof of concept. The remaining 6 endpoint files can follow in a follow-up — the type system already covers them. 53 duplicated fetch wrappers consolidated into a single 78-line factory.' },

  /* ── Reply/quote: User asks follow-up about call-site migration ── */
  {
    id: 'bu3', kind: 'text', createdAt: T(30), author: U('alice'),
    text: 'What about the 31 call sites you mentioned? When will those be updated?',
    replyToMessageId: 'ba4',
    replyPreview: 'All done. Generic API client deployed: src/api/types.ts (32 lines)...',
    replyAuthor: 'Builder',
    quote: 'The remaining 6 endpoint files can follow in a follow-up — the type system already covers them.',
  },

  /* ── Reply/quote: Builder responds to the quoted message ── */
  {
    id: 'ba5', kind: 'text', createdAt: T(31), author: B('builder'),
    text: 'Good question. I already surveyed all 31 import sites during the Grep analysis. The call-site migration is non-breaking since the legacy client.ts still exports the old named functions as compatibility stubs. We can migrate incrementally — each call site is a one-liner change from `getUsers({page, limit})` to `usersApi.list({page, limit})`. I recommend a separate PR for that to keep this one focused on the core generic client.',
    displayTitle: 'Call-site migration plan',
    displayDetail: '31 import sites, non-breaking incremental migration, separate PR recommended.',
  },

  /* ── Reply: User pins down the timeline ── */
  {
    id: 'bu4', kind: 'text', createdAt: T(32), author: U('alice'),
    text: 'OK, let\'s do that as a follow-up today. Please create the tracking issue.',
    replyToMessageId: 'ba5',
    replyPreview: 'I already surveyed all 31 import sites during the Grep analysis...',
    replyAuthor: 'Builder',
  },

  /* ── Tool call with evidenceRefs ── */
  {
    id: 'bto11', kind: 'tool_call', createdAt: T(33), author: B('builder'),
    toolName: 'Write',
    status: 'completed',
    summary: 'Created tracking issue #1224 — "Migrate 31 call sites to generic API client"',
    evidenceRefs: [
      { id: 'ev_issue_1224', kind: 'artifact', label: 'Issue #1224 — Call-site migration tracker', status: 'completed', path: 'docs/issues/1224-call-site-migration.md' },
      { id: 'ev_survey_grep', kind: 'tool', label: 'Grep survey of 31 import sites', status: 'completed', path: 'src/', uri: '/evidence/btr7' },
      { id: 'ev_compat_stubs', kind: 'file', label: 'Legacy compatibility stubs in client.ts', status: 'completed', path: 'src/api/client.ts' },
    ],
  },

  /* ── Tool result with evidenceRefs ── */
  {
    id: 'btr11', kind: 'tool_result', createdAt: T(33.5), author: B('builder'),
    toolName: 'Write',
    status: 'completed',
    summary: 'docs/issues/1224-call-site-migration.md · 95 lines · migration plan with 31 checkboxes, estimated 2h effort, non-breaking incremental approach',
    evidenceRefs: [
      { id: 'ev_issue_1224', kind: 'artifact', label: 'Issue #1224 — Call-site migration tracker', status: 'completed', path: 'docs/issues/1224-call-site-migration.md' },
    ],
  },

  /* ── Deployment preview block ── */
  {
    id: 'bprev1', kind: 'preview', createdAt: T(34), author: B('builder'),
    previewId: 'preview_f7c92a',
    threadId: 'thread_builder_001',
    status: 'completed',
    // Themed blank — never load external white placeholder pages (#1247)
    url: 'about:blank',
  },

  /* ── Second preview (still running for testing the pending state) ── */
  {
    id: 'bprev2', kind: 'preview', createdAt: T(34.5), author: B('builder'),
    previewId: 'preview_e2b890',
    threadId: 'thread_builder_001',
    status: 'running',
    url: 'about:blank',
  },

  /* ── Second approval (waiting state, exercises onApprove/onReject) ── */
  {
    id: 'bap2', kind: 'approval', createdAt: T(35), author: B('builder'),
    title: 'Migrate 31 call sites (non-breaking, incremental)', status: 'waiting' as unknown as EvidenceRefStatus,
    risk: 'low',
    reason: 'Non-breaking incremental migration. Each call site changes one import line. Legacy stubs remain active until all call sites are migrated. Rollback: revert the PR — old client.ts untouched throughout.',
  },

  /* ── Goal closed: migration finished, goal marked complete (#1998, UX F8) ── */
  {
    id: 'bgoal2', kind: 'tool_call', createdAt: T(37), author: B('builder'),
    callId: 'call-goal-update',
    toolName: 'update_goal',
    status: 'completed',
    input: { status: 'complete' },
  },
  { id: 'bgoal2r', kind: 'tool_result', createdAt: T(37.5), author: B('builder'), callId: 'call-goal-update', toolName: 'update_goal', status: 'completed', summary: 'Goal marked complete' },

  /* ── Thinking with evidenceRefs ── */
  {
    id: 'bth7', kind: 'thinking', createdAt: T(36), author: B('builder'),
    content: 'The tracking issue #1224 is created with 31 checkboxes. Each checkbox maps to a concrete import site found during the Grep survey. The migration is safe because legacy exports remain in place via client.ts — old code still works even if only half the call sites are migrated. The work can be parallelized across 9 files. Caveat: one call site (src/components/UserTable.tsx) uses getUsers with extra query params beyond the standard pagination; the generic client supports searchParams so this is covered, but needs a small signature adjustment in the endpoint def.',
    isThinking: false,
    evidenceRefs: [
      { id: 'ev_issue_1224', kind: 'artifact', label: 'Issue #1224', status: 'completed' },
      { id: 'ev_survey_grep', kind: 'tool', label: 'Grep survey', status: 'completed' },
      { id: 'ev_usertable', kind: 'file', label: 'UserTable.tsx — extra query params edge case', status: 'completed', path: 'src/components/UserTable.tsx' },
    ],
  },
]
