/* ═══════════════════════════════════════════════════════════════════════
   CHATVIEW FIXTURES — TranscriptBlock[] for demo conversations
   Data-driven mock — zero hardcoded UI strings in components.
   Wired into resolveDemoWorkbenchTranscript via demoWorkbenchTranscripts.
   ══════════════════════════════════════════════════════════════════════ */

import type { TranscriptBlock } from '../transcript/types'

const TS = '2026-06-17T14:30:00+08:00'
const T = (offsetMin: number) => {
  const d = new Date('2026-06-17T14:30:00+08:00')
  d.setMinutes(d.getMinutes() + offsetMin)
  return d.toISOString()
}

const B = (id: string, name = 'Builder') => ({ id, name, role: 'agent' as const })
const U = (id: string, name = 'Ding') => ({ id, name, role: 'human' as const })

// ═══════════════════════════════════════════════════════════════════════
// Builder DM — long realistic ReAct: "Refactor the API client layer to use generics"
// ~55 blocks: user msg → plan → run_session → think×3 → tool×10 → file×5 → sub×2 → approval → deploy → context
// ═══════════════════════════════════════════════════════════════════════

export const chatviewBuilderTranscript: TranscriptBlock[] = [
  /* ── Attachment: Existing client layer survey ── */
  {
    id: 'batt1', kind: 'attachment', createdAt: T(0.5),
    author: U('ding'),
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
  { id: 'bu1', kind: 'text', createdAt: T(0), author: U('ding'), text: 'Refactor the API client layer to use generics. Right now every endpoint has its own fetch wrapper with duplicated response parsing, error handling, and type casting. I want a single typed client like createApiClient<MySchema>() that gives full type safety on request params, response body, and error shapes.' },

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
  { id: 'btr5', kind: 'tool_result', createdAt: T(12), author: B('builder'), toolName: 'Grep', status: 'completed', summary: 'src/api/ → "response\.json\|\.catch\|as Promise\|fetch(" · 53 matches · 8 endpoint files · identical error-handling pattern repeated everywhere' },

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
    title: 'Write 5 files (2 new, 3 modified)', status: 'pending',
    reason: 'Builder requests creation of src/api/types.ts, src/api/create-client.ts and modification of 3 existing files. All type checks and lint pass. Confirmation required to proceed.',
  },
  { id: 'bu2', kind: 'text', createdAt: T(24), author: U('ding'), text: 'Looks good, approved. Go ahead and write the files.' },
  { id: 'ba3', kind: 'text', createdAt: T(25), author: B('builder'), text: 'Approval granted. Writing files and deploying preview.' },

  /* ── Deploy ── */
  {
    id: 'bdep1', kind: 'deploy', createdAt: T(26), author: B('builder'),
    runId: 'run_builder_001', status: 'deployed', url: 'https://preview.example.com/deploy-f7c92a',
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
]

// ═══════════════════════════════════════════════════════════════════════
// Agent Collab Group — long realistic: "Add RBAC middleware"
// ~45 blocks: Orchestrator think×2 → tool×6 → route → Builder → Reviewer → QA → context
// ═══════════════════════════════════════════════════════════════════════

const O = (id: string) => ({ id, name: 'Orchestrator', role: 'agent' as const })
const R = (id: string) => ({ id, name: 'Reviewer', role: 'agent' as const })
const Q = (id: string) => ({ id, name: 'QA', role: 'agent' as const })

export const chatviewAgentCollabTranscript: TranscriptBlock[] = [
  /* ── Attachment: Current middleware chain diagram ── */
  {
    id: 'gatt1', kind: 'attachment', createdAt: T(0.3),
    author: U('ding'),
    attachmentRef: {
      id: 'att_9e4f8d2a',
      name: 'middleware-chain.png',
      original_name: 'middleware-chain.png',
      size: 187234,
      mime_type: 'image/png',
      hash: 'sha256:b1fedc3b4a59aabb',
      url: '/client/attachments/att_9e4f8d2a',
      metadata: '{"width": 1440, "height": 900}',
      created_at: T(0),
    },
    contentType: 'image',
  },

  /* ── User dispatches to Orchestrator ── */
  { id: 'gu1', kind: 'text', createdAt: T(0), author: U('ding'), text: '@Orchestrator Add RBAC middleware to the API gateway. We need role-based access control with three roles (admin, editor, viewer), per-endpoint permission configuration, and a deny-by-default policy. The middleware should integrate with the existing JWT auth layer and be configurable via a YAML policy file.' },

  /* ── Orchestrator think 1: Understand scope ── */
  {
    id: 'goth1', kind: 'thinking', createdAt: T(1), author: O('orch'),
    content: 'RBAC middleware request from @Ding. Key requirements: (1) three roles — admin, editor, viewer, (2) per-endpoint permission configuration, (3) deny-by-default policy, (4) integration with existing JWT auth middleware, (5) YAML policy file for configuration. Need to understand the current middleware chain, auth module, and routing structure before decomposing the work.',
    isThinking: false,
  },

  /* ── Orchestrator tool calls (3 total) ── */
  { id: 'goto1', kind: 'tool_call', createdAt: T(2), author: O('orch'), toolName: 'Read', status: 'running' },
  { id: 'gotr1', kind: 'tool_result', createdAt: T(3), author: O('orch'), toolName: 'Read', status: 'completed', summary: 'src/middleware/index.ts · 45 lines · current chain: cors → auth → rateLimit → router' },
  { id: 'goto2', kind: 'tool_call', createdAt: T(4), author: O('orch'), toolName: 'Read', status: 'running' },
  { id: 'gotr2', kind: 'tool_result', createdAt: T(5), author: O('orch'), toolName: 'Read', status: 'completed', summary: 'src/auth/jwt.ts · 126 lines · verifyToken extracts { userId, role } from payload, attaches to ctx.state.auth' },
  { id: 'goto3', kind: 'tool_call', createdAt: T(6), author: O('orch'), toolName: 'Grep', status: 'running' },
  { id: 'gotr3', kind: 'tool_result', createdAt: T(7), author: O('orch'), toolName: 'Grep', status: 'completed', summary: 'src/ → "router\.(get|post|put|patch|delete)" · 34 routes · 12 endpoint files · no role checks in any handler body' },
  { id: 'goto4', kind: 'tool_call', createdAt: T(7.2), author: O('orch'), toolName: 'Read', status: 'running' },
  { id: 'gotr4', kind: 'tool_result', createdAt: T(7.4), author: O('orch'), toolName: 'Read', status: 'completed', summary: 'src/router/index.ts · 67 lines · route tree with 34 endpoints grouped into 5 resource modules (users, projects, tasks, billing, admin)' },

  /* ── Orchestrator think 2: Decompose ── */
  {
    id: 'goth2', kind: 'thinking', createdAt: T(8), author: O('orch'),
    content: 'Survey complete. Current middleware chain is cors → auth → rateLimit → router. The JWT auth middleware already extracts role from the token payload into ctx.state.auth.role, but no downstream handler checks it — all 34 routes across 12 endpoint files are open to any authenticated user. Work decomposition: Builder writes the rbac middleware + policy loader + YAML config schema, Reviewer audits implementation against OWASP RBAC guidelines, QA runs integration tests across all three roles + unauthenticated + missing-policy edge cases.',
    isThinking: false,
  },

  /* ── Route decision ── */
  {
    id: 'gort1', kind: 'route_decision', createdAt: T(9), author: O('orch'),
    action: 'Decomposed · 3 agents sequential',
    summary: 'Builder implements RBAC middleware + policy loader + YAML policy file. Reviewer audits for OWASP compliance and privilege escalation. QA runs integration tests across all three roles (admin full access, editor write-own read-all, viewer read-only) plus negative cases.',
    targetAgent: 'Builder → Reviewer → QA',
  },
  { id: 'go1', kind: 'text', createdAt: T(10), author: O('orch'), text: 'Scope analyzed. Current state: 34 routes across 12 endpoint files, all open to any authenticated user. JWT already carries role in token payload. Decomposing into 3 sequential phases: Builder (implementation) → Reviewer (security audit) → QA (integration tests).', displayDetail: '34 routes currently open to any authenticated user. JWT already carries role. 3 sequential phases: Builder → Reviewer → QA.' },

  /* ── Builder think 1 ── */
  {
    id: 'gbth1', kind: 'thinking', createdAt: T(11), author: B('builder2'),
    content: 'Implementation plan: (1) define Role enum and PolicyEntry interface in src/auth/rbac-types.ts, (2) create rbac-policy.yaml with per-method role allowlists for all 34 routes, (3) implement policy-loader.ts to parse YAML, validate structure, and cache in module scope, (4) implement rbac-middleware.ts that reads ctx.state.auth.role, matches against loaded policy, and returns 403 on deny-by-default, (5) insert rbacMiddleware into the chain: cors → auth → rbac → rateLimit → router. Total: 4 new files, 1 modified file.',
    isThinking: false,
  },

  /* ── Builder tool calls (2 total) ── */
  { id: 'gbto1', kind: 'tool_call', createdAt: T(12), author: B('builder2'), toolName: 'Read', status: 'running' },
  { id: 'gbtr1', kind: 'tool_result', createdAt: T(13), author: B('builder2'), toolName: 'Read', status: 'completed', summary: 'src/middleware/index.ts · 45 lines · confirms middleware chain order and composeMiddleware signature' },
  { id: 'gbto2', kind: 'tool_call', createdAt: T(14), author: B('builder2'), toolName: 'Read', status: 'running' },
  { id: 'gbtr2', kind: 'tool_result', createdAt: T(15), author: B('builder2'), toolName: 'Read', status: 'completed', summary: 'src/auth/types.ts · 28 lines · AuthState { userId: string, role: string, permissions?: string[] }' },

  /* ── Builder file changes (5 total) ── */
  {
    id: 'gbf1', kind: 'file_change', createdAt: T(16), author: B('builder2'),
    path: 'src/auth/rbac-types.ts', action: 'created', additions: 34,
  },
  {
    id: 'gbf2', kind: 'file_change', createdAt: T(17), author: B('builder2'),
    path: 'src/middleware/rbac-policy.yaml', action: 'created', additions: 56,
  },
  {
    id: 'gbf3', kind: 'file_change', createdAt: T(18), author: B('builder2'),
    path: 'src/middleware/policy-loader.ts', action: 'created', additions: 42,
  },
  {
    id: 'gbf4', kind: 'file_change', createdAt: T(19), author: B('builder2'),
    path: 'src/middleware/rbac-middleware.ts', action: 'created', additions: 48,
  },
  {
    id: 'gbf5', kind: 'file_change', createdAt: T(20), author: B('builder2'),
    path: 'src/middleware/index.ts', action: 'modified', additions: 6, deletions: 2,
  },

  /* ── Builder diff ── */
  {
    id: 'gbdiff1', kind: 'diff', createdAt: T(20.5),
    author: B('builder2'),
    title: 'src/middleware/rbac-middleware.ts — RBAC enforcement middleware',
    files: ['src/middleware/rbac-middleware.ts'],
    additions: 48, deletions: 0,
    patch: '@@ -0,0 +1,48 @@\n+import type { Context, Next } from "koa";\n+import { loadPolicy } from "./policy-loader";\n+\n+export function rbacMiddleware() {\n+  const policy = loadPolicy();\n+\n+  return async (ctx: Context, next: Next) => {\n+    const role = ctx.state.auth?.role;\n+    if (!role) {\n+      ctx.status = 401;\n+      ctx.body = { error: "Unauthorized" };\n+      return;\n+    }\n+    const entry = policy[ctx.path];\n+    if (!entry) {\n+      ctx.status = 403;\n+      ctx.body = { error: "Forbidden: no policy for this endpoint" };\n+      return;\n+    }\n+    const allowed = entry.allowRoles;\n+    if (!allowed.includes(role)) {\n+      ctx.status = 403;\n+      ctx.body = { error: `Forbidden: role ${role} not allowed` };\n+      return;\n+    }\n+    await next();\n+  };\n+}\n',
    lines: [
      { type: 'add', content: 'import type { Context, Next } from "koa";' },
      { type: 'add', content: 'import { loadPolicy } from "./policy-loader";' },
      { type: 'add', content: '' },
      { type: 'add', content: 'export function rbacMiddleware() {' },
      { type: 'add', content: '  const policy = loadPolicy();' },
      { type: 'add', content: '' },
      { type: 'add', content: '  return async (ctx: Context, next: Next) => {' },
      { type: 'add', content: '    const role = ctx.state.auth?.role;' },
      { type: 'add', content: '    if (!role) {' },
      { type: 'add', content: '      ctx.status = 401;' },
      { type: 'add', content: '      ctx.body = { error: "Unauthorized" };' },
      { type: 'add', content: '      return;' },
      { type: 'add', content: '    }' },
      { type: 'add', content: '    const entry = policy[ctx.path];' },
      { type: 'add', content: '    if (!entry) {' },
      { type: 'add', content: '      ctx.status = 403;' },
      { type: 'add', content: '      ctx.body = { error: "Forbidden: no policy for this endpoint" };' },
      { type: 'add', content: '      return;' },
      { type: 'add', content: '    }' },
      { type: 'add', content: '    const allowed = entry.allowRoles;' },
      { type: 'add', content: '    if (!allowed.includes(role)) {' },
      { type: 'add', content: '      ctx.status = 403;' },
      { type: 'add', content: '      ctx.body = { error: `Forbidden: role ${role} not allowed` };' },
      { type: 'add', content: '      return;' },
      { type: 'add', content: '    }' },
      { type: 'add', content: '    await next();' },
      { type: 'add', content: '  };' },
      { type: 'add', content: '}' },
    ],
  },

  /* ── Builder diff 2: Policy YAML ── */
  {
    id: 'gbdiff2', kind: 'diff', createdAt: T(20.7),
    author: B('builder2'),
    title: 'src/middleware/rbac-policy.yaml — Per-endpoint role allowlists',
    files: ['src/middleware/rbac-policy.yaml'],
    additions: 56, deletions: 0,
    patch: '@@ -0,0 +1,56 @@\n+# RBAC Policy — deny-by-default\n+routes:\n+  /api/users:\n+    GET:    { allowRoles: [admin, editor, viewer] }\n+    POST:   { allowRoles: [admin] }\n+  /api/users/:id:\n+    GET:    { allowRoles: [admin, editor, viewer] }\n+    PATCH:  { allowRoles: [admin, editor] }\n+    DELETE: { allowRoles: [admin] }\n+  /api/projects:\n+    GET:    { allowRoles: [admin, editor, viewer] }\n+    POST:   { allowRoles: [admin, editor] }\n+  /api/projects/:id:\n+    GET:    { allowRoles: [admin, editor, viewer] }\n+    PATCH:  { allowRoles: [admin, editor] }\n+    DELETE: { allowRoles: [admin] }\n+  /api/tasks:\n+    GET:    { allowRoles: [admin, editor, viewer] }\n+    POST:   { allowRoles: [admin, editor] }\n+  /api/tasks/:id:\n+    GET:    { allowRoles: [admin, editor, viewer] }\n+    PATCH:  { allowRoles: [admin, editor] }\n+    DELETE: { allowRoles: [admin, editor] }\n+  /api/billing:\n+    GET:    { allowRoles: [admin] }\n+  /api/admin/*:\n+    "*":   { allowRoles: [admin] }\n',
    lines: [
      { type: 'add', content: '# RBAC Policy — deny-by-default' },
      { type: 'add', content: 'routes:' },
      { type: 'add', content: '  /api/users:' },
      { type: 'add', content: '    GET:    { allowRoles: [admin, editor, viewer] }' },
      { type: 'add', content: '    POST:   { allowRoles: [admin] }' },
      { type: 'add', content: '  /api/users/:id:' },
      { type: 'add', content: '    GET:    { allowRoles: [admin, editor, viewer] }' },
      { type: 'add', content: '    PATCH:  { allowRoles: [admin, editor] }' },
      { type: 'add', content: '    DELETE: { allowRoles: [admin] }' },
      { type: 'add', content: '  /api/projects:' },
      { type: 'add', content: '    GET:    { allowRoles: [admin, editor, viewer] }' },
      { type: 'add', content: '    POST:   { allowRoles: [admin, editor] }' },
      { type: 'add', content: '  /api/projects/:id:' },
      { type: 'add', content: '    GET:    { allowRoles: [admin, editor, viewer] }' },
      { type: 'add', content: '    PATCH:  { allowRoles: [admin, editor] }' },
      { type: 'add', content: '    DELETE: { allowRoles: [admin] }' },
      { type: 'add', content: '  /api/tasks:' },
      { type: 'add', content: '    GET:    { allowRoles: [admin, editor, viewer] }' },
      { type: 'add', content: '    POST:   { allowRoles: [admin, editor] }' },
      { type: 'add', content: '  /api/tasks/:id:' },
      { type: 'add', content: '    GET:    { allowRoles: [admin, editor, viewer] }' },
      { type: 'add', content: '    PATCH:  { allowRoles: [admin, editor] }' },
      { type: 'add', content: '    DELETE: { allowRoles: [admin, editor] }' },
      { type: 'add', content: '  /api/billing:' },
      { type: 'add', content: '    GET:    { allowRoles: [admin] }' },
      { type: 'add', content: '  /api/admin/*:' },
      { type: 'add', content: '    "*":   { allowRoles: [admin] }' },
    ],
  },

  /* ── Builder text bubble ── */
  { id: 'gb1', kind: 'text', createdAt: T(21), author: B('builder2'), text: 'RBAC middleware implemented. Four new files: rbac-types.ts (role enum + policy types), rbac-policy.yaml (34 endpoint allowlists for admin/editor/viewer), policy-loader.ts (YAML parser with validation), rbac-middleware.ts (deny-by-default enforcement with 401/403 responses). Middleware chain updated: cors → auth → rbac → rateLimit → router. Handing off to Reviewer for security audit.', displayDetail: 'Four new files, middleware chain updated to cors → auth → rbac → rateLimit → router. Handing off to Reviewer.' },

  /* ── Reviewer think 1 ── */
  {
    id: 'grth1', kind: 'thinking', createdAt: T(22), author: R('reviewer'),
    content: 'Security audit of RBAC middleware. Checklist: (1) deny-by-default correctly enforced — does a missing policy entry return 403 before the route handler executes? (2) role extraction from JWT — is ctx.state.auth.role guaranteed to exist after the auth middleware runs? (3) policy validation — does the loader catch malformed YAML at startup (fail-closed)? (4) privilege escalation vectors — can a viewer access admin-only routes to delete users? (5) timing attacks — does the middleware short-circuit before any business logic runs on deny? Read all four new files.',
    isThinking: false,
  },

  /* ── Reviewer tool calls (3 total) ── */
  { id: 'grto1', kind: 'tool_call', createdAt: T(23), author: R('reviewer'), toolName: 'Read', status: 'running' },
  { id: 'grtr1', kind: 'tool_result', createdAt: T(24), author: R('reviewer'), toolName: 'Read', status: 'completed', summary: 'src/middleware/rbac-middleware.ts · 48 lines · deny-by-default enforced, 401 for missing role, 403 for missing policy or disallowed role' },
  { id: 'grto2', kind: 'tool_call', createdAt: T(25), author: R('reviewer'), toolName: 'Read', status: 'running' },
  { id: 'grtr2', kind: 'tool_result', createdAt: T(26), author: R('reviewer'), toolName: 'Read', status: 'completed', summary: 'src/middleware/policy-loader.ts · 42 lines · parses YAML with js-yaml, validates allowRoles is string[], caches in module scope at require time' },
  { id: 'grto3', kind: 'tool_call', createdAt: T(27), author: R('reviewer'), toolName: 'Read', status: 'running' },
  { id: 'grtr3', kind: 'tool_result', createdAt: T(28), author: R('reviewer'), toolName: 'Read', status: 'completed', summary: 'src/middleware/rbac-policy.yaml · 56 lines · 34 endpoints, each with allowRoles: [admin] or [admin, editor] or [admin, editor, viewer]' },

  /* ── Reviewer think 2: Findings ── */
  {
    id: 'grth2', kind: 'thinking', createdAt: T(29), author: R('reviewer'),
    content: 'Audit findings: (1) Deny-by-default correctly enforced — missing policy entry returns 403 before route handler via early return. (2) Role from JWT — ctx.state.auth.role is set by auth middleware which runs before rbac in the chain; order guarantees presence. (3) Policy loader validates structure at startup — malformed YAML throws synchronously (fail-closed, server will not start). (4) No privilege escalation path — admin-only routes (user deletion, billing, system config) correctly restricted to role "admin" in policy. Viewer cannot escalate. (5) No timing attack surface — middleware returns immediately on deny, no database or I/O on the deny path. One observation: policy is loaded once at module init, so changes require a server restart — acceptable for current deployment model. Recommend approval.',
    isThinking: false,
  },

  /* ── Reviewer subagent ── */
  {
    id: 'grsub1', kind: 'subagent', createdAt: T(30), author: R('reviewer'),
    title: 'OWASP RBAC checklist audit', worker: 'SecurityAuditor', status: 'completed',
    summary: 'OWASP RBAC checklist: all 8 items passed. No broken access control (BAC), no insecure direct object reference (IDOR) vectors, deny-by-default confirmed, role hierarchy intact, policy file readable by server process only.',
  },

  /* ── Reviewer text bubble ── */
  { id: 'gr1', kind: 'text', createdAt: T(31), author: R('reviewer'), text: 'Security review passed. Deny-by-default correctly enforced, no privilege escalation paths, OWASP RBAC checklist all green. One note: policy is loaded at startup only, changes require a restart. Recommend merge. Handing off to QA for integration testing.', displayDetail: 'Deny-by-default enforced, no privilege escalation, OWASP checklist all green. Recommend merge.' },

  /* ── QA think 1 ── */
  {
    id: 'gqth1', kind: 'thinking', createdAt: T(32), author: Q('qa'),
    content: 'Integration test plan: (1) admin role — verify all 34 endpoints accessible, (2) editor role — verify write access to own resources, read access to all, denied on admin-only routes (user deletion, billing), (3) viewer role — verify read-only access on GET endpoints, denied on all POST/PUT/PATCH/DELETE, (4) unauthenticated — verify 401 on all routes, (5) missing-policy endpoint — verify 403 deny-by-default. Run test suite and lint.',
    isThinking: false,
  },

  /* ── QA tool calls (2 total) ── */
  { id: 'gqto1', kind: 'tool_call', createdAt: T(33), author: Q('qa'), toolName: 'Test', status: 'running' },
  { id: 'gqtr1', kind: 'tool_result', createdAt: T(34), author: Q('qa'), toolName: 'Test', status: 'completed', summary: 'pnpm test -- --testPathPattern=rbac · 28/28 passed · admin 8, editor 10, viewer 6, negative 4 · 4.1s' },
  { id: 'gqto2', kind: 'tool_call', createdAt: T(35), author: Q('qa'), toolName: 'Lint', status: 'running' },
  { id: 'gqtr2', kind: 'tool_result', createdAt: T(36), author: Q('qa'), toolName: 'Lint', status: 'completed', summary: 'eslint + prettier · 0 errors, 0 warnings · 5 files checked' },

  { id: 'gqto3', kind: 'tool_call', createdAt: T(36.2), author: Q('qa'), toolName: 'TypeCheck', status: 'running' },
  { id: 'gqtr3', kind: 'tool_result', createdAt: T(36.4), author: Q('qa'), toolName: 'TypeCheck', status: 'completed', summary: 'tsc --noEmit · 0 errors · strict mode · all 5 files type-check cleanly' },

  /* ── QA subagent ── */
  {
    id: 'gqsub1', kind: 'subagent', createdAt: T(36.6), author: Q('qa'),
    title: 'Coverage audit — verify all roles tested', worker: 'CoverageBot', status: 'completed',
    summary: 'Branch coverage: 94%. All 3 roles covered for every endpoint. Negative cases cover all deny paths (401 no role, 403 missing policy, 403 disallowed role). No dead code in middleware.',
  },

  /* ── QA think 2: All passed ── */
  {
    id: 'gqth2', kind: 'thinking', createdAt: T(37), author: Q('qa'),
    content: 'All 28 integration tests passed across all three roles plus negative cases. Admin: 8/8 (full CRUD on all resources including user deletion and billing). Editor: 10/10 (CRUD own resources, read all, denied on admin-only). Viewer: 6/6 (read-only on GET endpoints, denied on all write operations). Negative: 4/4 — 401 unauthenticated, 403 missing policy entry, 403 viewer attempting POST, 403 editor attempting admin-only DELETE. Lint clean across 5 files. Ready to merge.',
    isThinking: false,
  },

  /* ── QA text bubble ── */
  { id: 'gq1', kind: 'text', createdAt: T(38), author: Q('qa'), text: 'Final acceptance passed. 28/28 integration tests (admin 8, editor 10, viewer 6, negative 4), 0 lint errors. RBAC deny-by-default verified, all three roles behave correctly, no privilege escalation possible. Ready to merge.', displayDetail: '28/28 integration tests passed, 0 lint errors. All three roles behave correctly. Ready to merge.' },

  /* ── Context usage ── */
  {
    id: 'gctx1', kind: 'context_usage', createdAt: T(39), author: Q('qa'),
    inputTokens: 178000, outputTokens: 6200, usagePercent: 89,
    contextLimit: 200000, modelLabel: 'Claude Sonnet 4',
    cachePercent: 15, cost: '$2.08',
  },
]
