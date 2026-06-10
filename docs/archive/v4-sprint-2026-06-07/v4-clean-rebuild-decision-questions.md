# AgentHub v4 Clean Rebuild 决策问题清单

> 最后更新：2026-06-07 | 用途：在实现前集中确认意图、约束和验收口径

## 0. 已确认决策

- 旧 UI 主路径最终彻底删除，不保留长期备用入口。
- Desktop 和 Web 同步进入 v4，不等 Desktop 完成后再迁移 Web。
- 实现分支允许短期打断旧 UI，但每个阶段必须提交新 UI 的构建、测试、截图或等价证据。
- UI 壳子全面参考 `agenthub-design/index.html` 和 `agenthub-design/desktop/`。

下面的问题不是阻塞开发的表格，而是为了防止重构中途回到旧路径。每个问题都给出推荐答案，用户只需要指出不同意的地方。

## 1. 成功标准

1. **这次 v4 重构的第一成功标准是什么？**
   推荐答案：Desktop/Web 看到的是同一个 AgentHub v4 工作台，不再是 Desktop 一套、Web 一套。

2. **如果只能演示一个场景，演示什么？**
   推荐答案：一个项目群聊里 @Agent 触发任务，transcript 展示工具/Diff/Approval/Artifact，右侧 inspector 汇总进度和产物。

3. **这次重构更重视“马上可跑”还是“架构彻底干净”？**
   推荐答案：先架构彻底干净，再做可跑闭环；允许实现分支短期打断旧 UI。

4. **是否接受旧 UI 在迁移期间不可用？**
   推荐答案：接受，但每个阶段必须有新 UI 的构建、测试或截图证据。

5. **旧 ChatView 备用入口处置**
   已确认：不允许保留备用入口。可以留历史归档或测试 fixture，不能留 active route。

## 2. UI 基准

6. **v4 UI 的权威来源是谁？**
   推荐答案：`agenthub-design/index.html` 和 `agenthub-design/desktop/` 是 UI 壳子的权威参考；AgentHub 仓内 shared React 实现是工程权威。

7. **是否要逐像素复制 design 原型？**
   推荐答案：不逐像素复制。复制信息架构、密度、交互和 token 意图，工程上转成共享 React 组件。

8. **Desktop/Web 的视觉差异允许到什么程度？**
   推荐答案：窗口壳、系统能力入口可以不同；主工作台、消息流、composer、inspector 必须一致。

9. **Mobile 是否进入本轮？**
   推荐答案：不进入 P0。Mobile 后续消费 shared workbench 的稳定子集，当前不阻塞 Desktop/Web。

10. **暗色模式是否是 P0？**
   推荐答案：不是。light-first 是 P0；暗色模式保留 token 结构和基本可读性，不作为首轮视觉门禁。

## 3. 架构边界

11. **shared UI 放在哪里？**
   推荐答案：放在 `app/shared/src/workbench`、`transcript`、`composer`、`inspector`、`platform`，基础组件继续在 `app/shared/src/ui`。

12. **Desktop/Web 是否可以各自维护 platform-specific 组件？**
   推荐答案：只能维护 adapter 和少量 host wrapper；产品 UI 不 fork。

13. **事件归一化在哪里做？**
   推荐答案：在 shared transcript normalization 层做，Desktop/Web adapters 只提供原始来源和 platform capability。

14. **Right Inspector 的数据权威来自哪里？**
   推荐答案：来自 transcript blocks 的 `EvidenceRef` 和 platform run/artifact ports，不从 DOM 或旧 RunDetail 抽取。

15. **composer submit 后谁决定执行路径？**
   推荐答案：shared composer 只发 intent，platform adapter 决定发 Local Edge、Hub task 还是 remote target。

## 4. 旧系统清理

16. **哪些旧文件是清理对象？**
   推荐答案：`ChatView`、`PromptInput`、`IMBlockRenderer`、`RunDetail`、`ThreadPanel`、旧 `viewRegistry`、`useChatMessages`、`useIMChat`、Web duplicate UI。

17. **旧 tests 怎么处理？**
   推荐答案：行为有价值的迁移到 shared tests；只覆盖旧实现细节的删除。

18. **旧 CSS module 怎么处理？**
   推荐答案：必要 token 和布局规则转入 shared workbench；组件私有旧 CSS 删除。

19. **是否保留旧 docs 中的历史方案？**
   推荐答案：可放 archive；active docs 不能继续要求读取旧状态入口或旧 UI 路线。

20. **旧分支是否保留？**
   推荐答案：不保留过时分支。只保留 `dev/delicious233`、`master`、`dev/trump`、`dev/johnny`。

## 5. Host API 和安全

21. **Tauri command 是否继续集中在 `commands.rs`？**
   推荐答案：不继续。拆为 edge/fs/dialog/auth/window/system 能力模块。

22. **文件系统能力默认开放到什么范围？**
   推荐答案：默认只允许用户选择或项目 workspace allowlist 内路径。

23. **Web 能否直接使用本机文件能力？**
   推荐答案：不能。Web 只能通过 Hub/remote target 能力和 browser-safe API。

24. **TokenDance ID token 能否当模型 API key？**
   推荐答案：不能。身份、Hub session、TokenDance API key 三者必须分开。

25. **审批能力由 UI 还是后端权威？**
   推荐答案：UI 只呈现和提交决策，Edge/Hub 是权限和状态权威。

## 6. 验收

26. **第一轮实现必须跑哪些检查？**
   推荐答案：shared tests、Desktop typecheck、Web typecheck/build、Tauri host tests、`git diff --check`。

27. **截图矩阵要覆盖什么？**
   推荐答案：Desktop/Web 各 1440x920、1280x800、390x844，至少覆盖对话、inspector、composer、设置或 Agent 工作台。

28. **怎样判定 UI 没有“看起来能用但工程不干净”？**
   推荐答案：active route 不再 import 旧 UI；Desktop/Web 只从 shared workbench 进入主工作台。

29. **怎样判定文档没有旧口径残留？**
   推荐答案：active docs 中不再出现旧主线描述；旧交接和历史状态只在 archive/reference 中保留。

30. **如果实现中发现 shared workbench 抽象不足怎么办？**
   推荐答案：先补 contract 和测试，再迁移组件；不在 Desktop/Web 各自打补丁绕过 shared。

## 7. 已确认拍板项

1. **是否确认旧 UI 主路径最终删除，而不是保留备用？**
   已确认：删除旧 UI 主路径，不保留长期备用入口。

2. **是否确认 Web 与 Desktop 同步进入 v4，而不是等 Desktop 完成后再迁移？**
   已确认：Web 与 Desktop 同步进入 v4。

3. **是否确认实现分支可以短期打断旧 UI，只要每阶段有新 UI 证据？**
   已确认：允许实现分支短期打断旧 UI，但每阶段必须有新 UI 证据。
