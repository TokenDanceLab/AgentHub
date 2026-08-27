/**
 * Chatview fixtures: Agent Collab group transcript.
 * Peel companion of chatviewFixtures (#1132). Pure only; zero behavior change.
 */

import type { EvidenceRefStatus, TranscriptBlock } from '../transcript/types'
import { B, T, U } from './chatviewFixturesHelpers'

// ═══════════════════════════════════════════════════════════════════════
// Agent Collab Group — long realistic: "Add RBAC middleware"
// ~60 blocks: Orchestrator think×2 → tool×6 → route → Builder → Reviewer → QA → reply×2 → approval → preview → context
// ═══════════════════════════════════════════════════════════════════════

const O = (id: string) => ({ id, name: 'Orchestrator', role: 'agent' as const })
const R = (id: string) => ({ id, name: 'Reviewer', role: 'agent' as const })
const Q = (id: string) => ({ id, name: 'QA', role: 'agent' as const })

export const chatviewAgentCollabTranscript: TranscriptBlock[] = [
  /* ── Attachment: Current middleware chain diagram ── */
  {
    id: 'gatt1', kind: 'attachment', createdAt: T(0.3),
    author: U('alice'),
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
  { id: 'gu1', kind: 'text', createdAt: T(0), author: U('alice'), text: '@Orchestrator Add RBAC middleware to the API gateway. We need role-based access control with three roles (admin, editor, viewer), per-endpoint permission configuration, and a deny-by-default policy. The middleware should integrate with the existing JWT auth layer and be configurable via a YAML policy file.' },

  /* ── Orchestrator think 1: Understand scope ── */
  {
    id: 'goth1', kind: 'thinking', createdAt: T(1), author: O('orch'),
    content: 'RBAC middleware request from @Alice. Key requirements: (1) three roles — admin, editor, viewer, (2) per-endpoint permission configuration, (3) deny-by-default policy, (4) integration with existing JWT auth middleware, (5) YAML policy file for configuration. Need to understand the current middleware chain, auth module, and routing structure before decomposing the work.',
    isThinking: false,
  },

  /* ── Goal registration: long RBAC task states its objective (#1998, UX F8) ── */
  {
    id: 'ggoal1', kind: 'tool_call', createdAt: T(1.5), author: O('orch'),
    callId: 'call-collab-goal-create',
    toolName: 'create_goal',
    status: 'completed',
    input: { objective: 'Ship deny-by-default RBAC middleware with admin/editor/viewer roles and YAML policy config' },
  },
  { id: 'ggoal1r', kind: 'tool_result', createdAt: T(1.6), author: O('orch'), callId: 'call-collab-goal-create', toolName: 'create_goal', status: 'completed', summary: 'Goal registered: RBAC middleware with three roles and YAML policy' },

  /* ── Orchestrator tool calls (3 total) ── */
  { id: 'goto1', kind: 'tool_call', createdAt: T(2), author: O('orch'), toolName: 'Read', status: 'running' },
  { id: 'gotr1', kind: 'tool_result', createdAt: T(3), author: O('orch'), toolName: 'Read', status: 'completed', summary: 'src/middleware/index.ts · 45 lines · current chain: cors → auth → rateLimit → router' },
  { id: 'goto2', kind: 'tool_call', createdAt: T(4), author: O('orch'), toolName: 'Read', status: 'running' },
  { id: 'gotr2', kind: 'tool_result', createdAt: T(5), author: O('orch'), toolName: 'Read', status: 'completed', summary: 'src/auth/jwt.ts · 126 lines · verifyToken extracts { userId, role } from payload, attaches to ctx.state.auth' },
  { id: 'goto3', kind: 'tool_call', createdAt: T(6), author: O('orch'), toolName: 'Grep', status: 'running' },
  { id: 'gotr3', kind: 'tool_result', createdAt: T(7), author: O('orch'), toolName: 'Grep', status: 'completed', summary: 'src/ → "router.(get|post|put|patch|delete)" · 34 routes · 12 endpoint files · no role checks in any handler body' },
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

  /* ── Reply/quote: User follows up on the RBAC policy ── */
  {
    id: 'gu2', kind: 'text', createdAt: T(40), author: U('alice'),
    text: 'One more thing -- can we also add a `billing-reader` role that only sees the billing GET endpoint but nothing else?',
    replyToMessageId: 'gq1',
    replyPreview: 'Final acceptance passed. 28/28 integration tests...',
    replyAuthor: 'QA',
    quote: 'all three roles behave correctly, no privilege escalation possible',
  },

  /* ── QA replies to the quoted follow-up ── */
  {
    id: 'gq2', kind: 'text', createdAt: T(41), author: Q('qa'),
    text: 'The current types already support that — we just need to add `billing-reader` to the Role enum and update the policy YAML to scoped allowlists. The middleware is generic enough that any new role Just Works once added to the allowlists. Should I open a follow-up issue?',
    replyToMessageId: 'gu2',
    replyPreview: 'can we also add a `billing-reader` role...',
    replyAuthor: 'Alice',
    displayTitle: 'Re: billing-reader role',
    displayDetail: 'Type system already supports new roles, just update Role enum + policy YAML.',
  },

  /* ── Approval block for the billing-reader follow-up ── */
  {
    id: 'gap1', kind: 'approval', createdAt: T(42), author: Q('qa'),
    title: 'Add billing-reader role (1 file change, 5 lines)', status: 'waiting' as unknown as EvidenceRefStatus,
    risk: 'low',
    reason: 'Single-file change: add `billing-reader` to Role enum in rbac-types.ts and add policy entries. No new middleware or logic changes. 0 risk of regression.',
    evidenceRefs: [
      { id: 'ev_rbac_types', kind: 'file', label: 'rbac-types.ts — Role enum definition', status: 'completed', path: 'src/auth/rbac-types.ts' },
      { id: 'ev_policy_yaml', kind: 'file', label: 'rbac-policy.yaml — current allowlists', status: 'completed', path: 'src/middleware/rbac-policy.yaml' },
    ],
  },

  /* ── Deploy preview for the RBAC PR ── */
  {
    id: 'gprev1', kind: 'preview', createdAt: T(43), author: Q('qa'),
    previewId: 'preview_rbac_a3c91d',
    threadId: 'thread_rbac_001',
    status: 'completed',
    // Themed blank — never load external white placeholder pages (#1247)
    url: 'about:blank',
  },
  /* ── Goal closed: RBAC middleware shipped, goal complete (#1998, UX F8) ── */
  {
    id: 'ggoal2', kind: 'tool_call', createdAt: T(39), author: O('orch'),
    callId: 'call-collab-goal-update',
    toolName: 'update_goal',
    status: 'completed',
    input: { status: 'complete' },
  },
  { id: 'ggoal2r', kind: 'tool_result', createdAt: T(39.5), author: O('orch'), callId: 'call-collab-goal-update', toolName: 'update_goal', status: 'completed', summary: 'Goal marked complete' },

]
