package store

// seed_data.go contains all demo data constants for the AgentHub Desktop demo experience.
// Data matches the frontend's workbenchDemo.ts, workbenchDemoData.ts, and teamrunDemo.ts
// so the app reads equivalent content through the real Edge API instead of hardcoded JS objects.

const (
	seedProjectID = "proj_demo"
	seedProjectName = "AgentHub Demo"
)

// seedThreadDef defines one demo conversation thread.
type seedThreadDef struct {
	ID       string
	Title    string
	Items    []seedItemDef
	Run      *seedRunDef
}

// seedItemDef defines one message/item within a thread.
type seedItemDef struct {
	ID      string
	Type    string // "user_message", "agent_message", "diff", "approval", "artifact", "file"
	Role    string // "user", "assistant", "agent", "system"
	Content string
	RunID   string // empty = no run association
}

// seedRunDef defines a run with associated evidence for the right sidebar.
type seedRunDef struct {
	ID        string
	Status    string // "finished", "started", "queued"
	Diffs     []seedDiffDef
	Artifacts []seedArtifactDef
	Previews  []seedPreviewDef
}

type seedDiffDef struct {
	Path   string
	Diff   string
	Status string // "added", "modified", "deleted"
}

type seedArtifactDef struct {
	ID        string
	Kind      string // "markdown", "file", "patch"
	Path      string
	SizeBytes int64
}

type seedPreviewDef struct {
	ID     string
	URL    string
	Status string // "ready", "starting"
}

// seedPinDef defines a pinned message.
type seedPinDef struct {
	ThreadID string
	ItemID   string
	PinnedBy string
}

// ─── All 10 demo threads ────────────────────────────────────────────────

var seedThreads = []seedThreadDef{
	// 1. Builder — B0 SQLite 迁移 (richest thread, matching builderTranscript)
	{
		ID:    "builder",
		Title: "Builder",
		Items: []seedItemDef{
			{ID: "builder-user-1", Type: "user_message", Role: "user", Content: "帮我给 AgentHub Desktop 做 B0 SQLite 迁移方案。要先看现有消息模型和索引路径，输出迁移 SQL、回滚点和需要验证的 UI 历史消息块。"},
			{ID: "builder-msg-1", Type: "agent_message", Role: "assistant", Content: "收到，我会先做运行隔离和代码定位。这次任务会按真实执行流推进：建立 worktree、加载调试和验证 skill、读取消息块类型、搜索 SQLite/FTS 入口，再生成迁移草案。", RunID: "run-builder-1"},
			{ID: "builder-msg-2", Type: "agent_message", Role: "assistant", Content: "找到迁移边界。消息正文、工具调用、文件变更、审批、上下文使用和子 Agent 事件需要保留 block kind。搜索只走 text/code/status/citation 的摘要字段，其他结构保持 JSON。", RunID: "run-builder-1"},
			{ID: "builder-msg-3", Type: "approval", Role: "assistant", Content: "部署/写入审批：生成迁移 SQL 和导航 hook 更新，需要写入工作区文件。", RunID: "run-builder-1"},
			{ID: "builder-msg-4", Type: "agent_message", Role: "assistant", Content: "生成迁移草案。我会新增线程表、消息块表和 FTS shadow index。回滚点放在切换查询路径之前，避免旧历史消息不可读。", RunID: "run-builder-1"},
			{ID: "builder-msg-5", Type: "artifact", Role: "assistant", Content: "migrations/0007_chat_threads.sql — 86 行新增，创建 chat_threads 表和 FTS5 虚表。", RunID: "run-builder-1"},
			{ID: "builder-msg-6", Type: "diff", Role: "assistant", Content: "migrations/0007_chat_threads.sql\nhooks/useThreadNavigation.ts", RunID: "run-builder-1"},
			{ID: "builder-msg-7", Type: "agent_message", Role: "assistant", Content: "迁移方案已完成。产物包括迁移 SQL、线程导航 hook 调整、回滚说明和验证清单。下一步交给 Reviewer 做风险复核，确认后再由 Deployer 做预览发布。", RunID: "run-builder-1"},
		},
		Run: &seedRunDef{
			ID:     "run-builder-1",
			Status: "finished",
			Diffs: []seedDiffDef{
				{
					Path: "migrations/0007_chat_threads.sql",
					Status: "added",
					Diff: `diff --git a/migrations/0007_chat_threads.sql b/migrations/0007_chat_threads.sql
--- /dev/null
+++ b/migrations/0007_chat_threads.sql
@@ -0,0 +1,12 @@
+BEGIN;
+
+CREATE TABLE IF NOT EXISTS chat_threads (
+  id TEXT PRIMARY KEY,
+  title TEXT NOT NULL,
+  updated_at INTEGER NOT NULL
+);
+
+CREATE VIRTUAL TABLE IF NOT EXISTS message_search
+USING fts5(thread_id, author, body);
+
+COMMIT;`,
				},
				{
					Path: "hooks/useThreadNavigation.ts",
					Status: "modified",
					Diff: `diff --git a/hooks/useThreadNavigation.ts b/hooks/useThreadNavigation.ts
--- a/hooks/useThreadNavigation.ts
+++ b/hooks/useThreadNavigation.ts
@@ -1,3 +1,8 @@
-export function useThreadNavigation(threadId: string) {
-  return { activeThreadId: threadId, openThread: (next: string) => next };
+export function useThreadNavigation(threadId: string) {
+  const [activeId, setActiveId] = useState(threadId);
+  return {
+    activeThreadId: activeId,
+    openThread: (next: string) => setActiveId(next),
+    sortBy: 'updated_at' as const,
+  };
 }`,
				},
				{
					Path: "B0-SQLITE-RISKS.md",
					Status: "added",
					Diff: `diff --git a/B0-SQLITE-RISKS.md b/B0-SQLITE-RISKS.md
--- /dev/null
+++ b/B0-SQLITE-RISKS.md
@@ -0,0 +1,6 @@
+# B0 SQLite 风险
+
+- 回滚脚本必须覆盖索引表与迁移状态。
+- FTS5 字段只保存可搜索摘要。
+- 导航 hook 不能改变现有 thread id。`,
				},
			},
			Artifacts: []seedArtifactDef{
				{ID: "artifact-builder-1", Kind: "markdown", Path: "sqlite-migration-plan.md", SizeBytes: 512},
				{ID: "artifact-builder-2", Kind: "file", Path: "migrations/0007_chat_threads.sql", SizeBytes: 256},
				{ID: "artifact-builder-3", Kind: "file", Path: "hooks/useThreadNavigation.ts", SizeBytes: 192},
				{ID: "artifact-builder-4", Kind: "markdown", Path: "B0-SQLITE-RISKS.md", SizeBytes: 148},
			},
			Previews: []seedPreviewDef{
				{ID: "preview-builder-1", URL: "http://127.0.0.1:5176/desktop/", Status: "ready"},
			},
		},
	},

	// 2. Agent 协作群 — Hub 消息闭环 (matching projectGroupMessageLoopHubMessages)
	{
		ID:    "agent-collab",
		Title: "Agent 协作群",
		Items: []seedItemDef{
			{ID: "collab-user-1", Type: "user_message", Role: "user", Content: "Builder，先把项目群消息闭环的 shared fixture contract 梳理出来。"},
			{ID: "collab-msg-1", Type: "agent_message", Role: "assistant", Content: "Reviewer，我会把 Hub message metadata 映射到 transcript，你复核 queued/assigned 可见性。", RunID: "run-collab-1"},
			{ID: "collab-user-2", Type: "user_message", Role: "user", Content: "@Reviewer 检查 Agent-to-Agent / 项目群 / @Agent 消息线，不启动真实长连接。"},
			{ID: "collab-msg-2", Type: "agent_message", Role: "system", Content: "task-a2a-review 已进入项目群 @Agent 队列，等待 Reviewer 接手。"},
			{ID: "collab-msg-3", Type: "agent_message", Role: "assistant", Content: "路由给 Reviewer 做 focused coverage，Builder 继续补 fixture contract。", RunID: "run-collab-1"},
			{ID: "collab-msg-4", Type: "agent_message", Role: "assistant", Content: "Reviewer 已完成 task-a2a-review，消息同步链进入 done。", RunID: "run-collab-1"},
		},
		Run: &seedRunDef{
			ID:     "run-collab-1",
			Status: "finished",
			Artifacts: []seedArtifactDef{
				{ID: "artifact-collab-1", Kind: "markdown", Path: "docs/contracts/project-group-fixture.md", SizeBytes: 1024},
				{ID: "artifact-collab-2", Kind: "file", Path: "tests/project-group-fixture.test.ts", SizeBytes: 768},
			},
		},
	},

	// 3. ByteDance TeamRun — fixture UI evidence (matching teamrunDemoTranscript)
	{
		ID:    "bytedance-teamrun",
		Title: "ByteDance TeamRun",
		Items: []seedItemDef{
			{ID: "teamrun-user-1", Type: "user_message", Role: "user", Content: "为 ByteDance demo 打开 TeamRun fixture，只做 UI evidence capture，不登录、不跑真实 CLI/model。"},
			{ID: "teamrun-msg-1", Type: "agent_message", Role: "assistant", Content: "TeamRun Console fixture state 已载入。teamrun-fixture-001 已完成，包含 supervisor 到 worker 的可回放路由、任务和事件列表。", RunID: "run-teamrun-1"},
			{ID: "teamrun-msg-2", Type: "agent_message", Role: "assistant", Content: "TeamRun route: agent.dispatch → run.agent.route_decision → team.route.decided → agent.dispatch → run.agent.result → team.run.completed。所有事件均为 fixture 记录，无真实运行。", RunID: "run-teamrun-1"},
			{ID: "teamrun-msg-3", Type: "agent_message", Role: "assistant", Content: "Worker fixture task completed: 返回 fixture 实现结果，无真实 CLI/model 进程启动。UI evidence 覆盖 transcript、right inspector files、route decision、task list 和 event list。", RunID: "run-teamrun-1"},
		},
		Run: &seedRunDef{
			ID:     "run-teamrun-1",
			Status: "finished",
			Diffs: []seedDiffDef{
				{
					Path:   "docs/competition/teamrun-demo-scenario.json",
					Status: "added",
					Diff: `diff --git a/docs/competition/teamrun-demo-scenario.json b/docs/competition/teamrun-demo-scenario.json
--- /dev/null
+++ b/docs/competition/teamrun-demo-scenario.json
@@ -0,0 +1,8 @@
+{
+  "contract": "teamrun-demo-evidence-v1",
+  "scenarioId": "bytedance-teamrun-fixture-minimum",
+  "fixtureOnly": true,
+  "state": { "status": "completed" }
+}`,
				},
			},
			Artifacts: []seedArtifactDef{
				{ID: "artifact-teamrun-1", Kind: "file", Path: "docs/competition/teamrun-demo-scenario.json", SizeBytes: 2048},
				{ID: "artifact-teamrun-2", Kind: "markdown", Path: "docs/competition/teamrun-evidence-report.md", SizeBytes: 1536},
			},
			Previews: []seedPreviewDef{
				{ID: "preview-teamrun-1", URL: "http://127.0.0.1:5176/desktop/teamrun/", Status: "ready"},
			},
		},
	},

	// 4. Deployer — 静态预览已就绪
	{
		ID:    "deployer",
		Title: "Deployer",
		Items: []seedItemDef{
			{ID: "deployer-user-1", Type: "user_message", Role: "user", Content: "把 B0 迁移方案的静态预览发布到本地 dev server。"},
			{ID: "deployer-msg-1", Type: "agent_message", Role: "assistant", Content: "静态预览已启动在 http://127.0.0.1:5176/desktop/，包含迁移 SQL diff、导航 hook 变更和风险说明。你可以在右侧栏浏览器 tab 里检查。", RunID: "run-deployer-1"},
			{ID: "deployer-msg-2", Type: "agent_message", Role: "assistant", Content: "预览健康检查通过。构建产物 12 个文件、总大小 340KB。FTS5 虚表查询在 100ms 内返回。", RunID: "run-deployer-1"},
		},
		Run: &seedRunDef{
			ID:     "run-deployer-1",
			Status: "finished",
			Artifacts: []seedArtifactDef{
				{ID: "artifact-deployer-1", Kind: "file", Path: "dist/preview-manifest.json", SizeBytes: 128},
			},
			Previews: []seedPreviewDef{
				{ID: "preview-deployer-1", URL: "http://127.0.0.1:5176/desktop/", Status: "ready"},
			},
		},
	},

	// 5. Orchestrator — 子任务分派
	{
		ID:    "orchestrator",
		Title: "Orchestrator",
		Items: []seedItemDef{
			{ID: "orch-user-1", Type: "user_message", Role: "user", Content: "把 B0 迁移任务拆成子任务分派给 Builder、Reviewer、Deployer。"},
			{ID: "orch-msg-1", Type: "agent_message", Role: "assistant", Content: "已分派 4 个子任务：\n1. Builder — 梳理消息模型 + 输出迁移 SQL（进行中）\n2. Reviewer — 复核 schema 风险（等待中）\n3. Researcher — 调研 FTS5 性能基线（等待中）\n4. Deployer — 预览发布（阻塞，等 Builder 完成）", RunID: "run-orch-1"},
			{ID: "orch-msg-2", Type: "agent_message", Role: "assistant", Content: "Builder 子任务状态：代码定位完成，正在生成迁移草案。预计 5 分钟内完成。Reviewer 已提前开始并行复核。", RunID: "run-orch-1"},
		},
		Run: &seedRunDef{
			ID:     "run-orch-1",
			Status: "started",
			Artifacts: []seedArtifactDef{
				{ID: "artifact-orch-1", Kind: "markdown", Path: "docs/tasks/b0-migration-taskboard.md", SizeBytes: 640},
			},
		},
	},

	// 6. Reviewer — 代码审查已通过
	{
		ID:    "reviewer",
		Title: "Reviewer",
		Items: []seedItemDef{
			{ID: "reviewer-user-1", Type: "user_message", Role: "user", Content: "审查 B0 SQLite 迁移方案，检查回滚安全和历史消息兼容性。"},
			{ID: "reviewer-msg-1", Type: "agent_message", Role: "assistant", Content: "审查完成，0 个阻塞项。\n\n通过项：\n- 迁移 SQL 可重复执行（IF NOT EXISTS 保护）\n- FTS5 虚表不写原始消息体，只存摘要\n- 回滚脚本覆盖索引表 + 迁移状态\n\n建议（非阻塞）：\n- 补充 idx_chat_threads_updated 在高频写入下的 perf 基线\n- 导航 hook 增加 debounce 避免快速切换时闪烁", RunID: "run-reviewer-1"},
		},
		Run: &seedRunDef{
			ID:     "run-reviewer-1",
			Status: "finished",
			Diffs: []seedDiffDef{
				{
					Path:   "docs/review/b0-sqlite-review.md",
					Status: "added",
					Diff: `diff --git a/docs/review/b0-sqlite-review.md b/docs/review/b0-sqlite-review.md
--- /dev/null
+++ b/docs/review/b0-sqlite-review.md
@@ -0,0 +1,4 @@
+# B0 SQLite 迁移审查
+
+- 0 个阻塞项
+- 2 个建议（非阻塞）`,
				},
			},
			Artifacts: []seedArtifactDef{
				{ID: "artifact-reviewer-1", Kind: "markdown", Path: "docs/review/b0-sqlite-review.md", SizeBytes: 320},
			},
		},
	},

	// 7. Johnny — 人类协作者
	{
		ID:    "johnny",
		Title: "Johnny",
		Items: []seedItemDef{
			{ID: "johnny-user-1", Type: "user_message", Role: "user", Content: "我看下项目页和私聊入口，确认侧栏对话列表能正确显示。"},
			{ID: "johnny-msg-1", Type: "agent_message", Role: "assistant", Content: "好的，你检查一下项目页的「进入工作区」按钮和侧栏私聊入口是否都正常跳转。有问题随时说。"},
		},
	},

	// 8. Trump — 人类协作者
	{
		ID:    "trump",
		Title: "Trump",
		Items: []seedItemDef{
			{ID: "trump-user-1", Type: "user_message", Role: "user", Content: "云文档列表可以再收紧一点，现在展示字段太多了。"},
			{ID: "trump-msg-1", Type: "agent_message", Role: "assistant", Content: "收到，我来精简文档列表展示字段。只保留标题、状态和更新时间，其他详细信息移到详情页。"},
		},
	},

	// 9. AI 游戏项目 — 项目群
	{
		ID:    "project-ai",
		Title: "AI 游戏项目",
		Items: []seedItemDef{
			{ID: "ai-user-1", Type: "user_message", Role: "user", Content: "AI 游戏项目的深度研究团队 5 人已经到位，可以开始了。"},
			{ID: "ai-msg-1", Type: "agent_message", Role: "assistant", Content: "AI 游戏项目已创建。团队成员：Delicious233（负责人）、Builder（开发）、Reviewer（审查）、Researcher（调研）、Deployer（发布）。", RunID: "run-ai-1"},
			{ID: "ai-msg-2", Type: "agent_message", Role: "assistant", Content: "Researcher 已完成竞品调研报告，覆盖 8 款主流 AI 游戏引擎。建议采用 RL + LLM hybrid 方案。", RunID: "run-ai-1"},
		},
		Run: &seedRunDef{
			ID:     "run-ai-1",
			Status: "started",
			Artifacts: []seedArtifactDef{
				{ID: "artifact-ai-1", Kind: "markdown", Path: "docs/research/ai-game-competition-report.md", SizeBytes: 4096},
				{ID: "artifact-ai-2", Kind: "file", Path: "docs/research/ai-game-engine-comparison.csv", SizeBytes: 2048},
			},
		},
	},

	// 10. 文档重构 — 项目群
	{
		ID:    "project-docs",
		Title: "文档重构",
		Items: []seedItemDef{
			{ID: "docs-user-1", Type: "user_message", Role: "user", Content: "文档重构项目启动。目标：统一中英文文档结构，补充缺失的 API 文档。"},
			{ID: "docs-msg-1", Type: "agent_message", Role: "assistant", Content: "文档重构已完成。变更摘要：\n- 新增 12 篇 API 文档\n- 统一中英文标题层级\n- 补充 4 个缺失的 error code 说明\n- 更新 README 中的快速开始指南", RunID: "run-docs-1"},
			{ID: "docs-msg-2", Type: "agent_message", Role: "assistant", Content: "所有文档已同步到 docs/ 目录。i18n parity 验证通过，中英文结构一致。", RunID: "run-docs-1"},
		},
		Run: &seedRunDef{
			ID:     "run-docs-1",
			Status: "finished",
			Diffs: []seedDiffDef{
				{
					Path:   "docs/api/README.md",
					Status: "modified",
					Diff: `diff --git a/docs/api/README.md b/docs/api/README.md
--- a/docs/api/README.md
+++ b/docs/api/README.md
@@ -1,2 +1,6 @@
 # API Documentation
-Coming soon.
+## Endpoints
+- GET /v1/threads
+- POST /v1/threads
+- GET /v1/threads/:id/items`,
				},
			},
			Artifacts: []seedArtifactDef{
				{ID: "artifact-docs-1", Kind: "markdown", Path: "docs/api/README.md", SizeBytes: 256},
			},
		},
	},
}

// seedPins defines pinned messages across demo threads.
var seedPins = []seedPinDef{
	{ThreadID: "builder", ItemID: "builder-msg-1", PinnedBy: "Delicious233"},
}
