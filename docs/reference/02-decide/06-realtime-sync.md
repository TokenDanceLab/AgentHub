# Cross-Analysis: Real-Time Collaboration & State Synchronization

> 分析日期: 2026-05-21
> 前置阅读: 03-eventstore-memory.md, 02-claude-sdk-impact.md, 01-adapters.md, 07-librechat.md, 05-undo-rollback.md, 03-orchestration.md

---

## 1. 多端同步的三种模型

AgentHub 的 seq-based EventStore（03-eventstore-memory.md Section 3.5）定义了明确的单写多读同步协议。但多 Tab/多端同时操作同一会话时，这个模型面临三种根本不同的冲突解决范式。

### 1.1 模型对比

| 维度 | Last-Write-Wins (LWW) | CRDT | OT |
|------|----------------------|------|----|
| **代表系统** | AgentHub seq-based, Kanna writeChain | Yjs, Automerge | Google Docs, ShareJS |
| **冲突解决** | 全局单调序列号，后者覆盖 | 数学可交换合并，无冲突 | 操作变换：`op1` 经 `op2` 变换后应用 |
| **离线能力** | 弱——离线写入需排队，重连时按 seq 重放 | 强——离线任意编辑，重连自动合并 | 中——需要中心服务器做变换 |
| **合并复杂度** | O(1)：seq 大的胜出 | O(n)：状态合并，取决于 CRDT 类型 | O(n^2)：操作变换矩阵 |
| **存储开销** | 低——单条 append-only JSONL | 高——需存储完整操作历史或状态向量 | 中——需存储操作日志 |
| **适用粒度** | 粗粒度（Thread/Turn/Message） | 任意粒度（字符级到文档级） | 中细粒度（字符/段落级） |
| **AgentHub 适配度** | **原生匹配**（seq 已存在） | 需引入新 CRDT 库 + 改造 EventStore | 不适合——Agent 对话不是线性文本编辑 |

### 1.2 核心判断：AgentHub 的冲突域不是字符编辑

Agent conversations 与 Google Docs 有本质区别：

```
Google Docs 的冲突域：
  用户 A 在第 5 行插入 "X"，用户 B 在第 5 行插入 "Y"
  → 需要字符级 OT 变换来保证一致性

AgentHub 的冲突域：
  用户 A 在 Thread T 追加 Turn，用户 B 在 Thread T 追加不同 Turn
  → 两个 Turn 都是合法操作，不存在要"变换"的共享文本
  → seq-based LWW 自然解决：谁先到达 Hub 谁获得更小 seq
  → 后到达的 Turn 追加为后续 Turn，两者都保留（非冲突）
```

**结论**：AgentHub 不需要 CRDT/OT。seq-based LWW 对 conversation-level 同步已足够。唯一需要 CRDT 的场景是 **多用户同时编辑同一 Agent prompt 文本内容**（见第 4 节）。

---

## 2. AgentHub seq-based Sync 的边界条件分析

### 2.1 协议回顾

```go
// Edge -> Hub 定期 poll
SyncRequest{ ProjectID, SinceSeq }
SyncResponse{ Events[] (delta), LatestSeq, Compacted, Snapshot }
```

### 2.2 边界条件枚举

#### Case 1: 两个 Edge 同时向同一 Thread 推送 Turn

```
时间线:
  t0: Thread T 的 LatestSeq = 100
  t1: Edge-A push TurnA (获得 seq 101-110)
  t2: Edge-B push TurnB (获得 seq 111-120) —— writeChain 串行化保证顺序

结果: TurnA (seq=101-110), TurnB (seq=111-120)。两者都保留。
      Edge-A 下次 poll SinceSeq=100 → 收到 TurnA + TurnB（因为它只看到了自己的）
      Edge-B 下次 poll SinceSeq=100 → 收到 TurnA + TurnB（一样）

冲突？无。两个 Turn 都是合法追加，顺序由 Hub 的 writeChain 决定。
语义上等价于"用户先说 A 再说 B"，不需要合并或冲突解决。
```

**边界风险**：如果 TurnA 和 TurnB 互相矛盾（如 TurnA 改文件 F，TurnB 删除文件 F），Hub 不做语义裁决。这是正确的——Hub 只负责事件顺序，语义一致性由 Runner/Orchestrator 在 Turn 执行时处理。

#### Case 2: Network Partition（Edge 离线）

```
时间线:
  t0: Edge 的 SinceSeq = 100, Hub 的 LatestSeq = 100
  t1: Edge 断网，本地继续产生 TurnC (暂存本地 events)
  t2: Hub 上另一个 Edge 推送 TurnD → Hub LatestSeq = 120
  t3: Edge 恢复连接，poll SinceSeq=100
  t4: Hub 返回 delta (seq 101-120 = TurnD events)
  t5: Edge 应用 delta，现在 Edge LatestSeq = 120
  t6: Edge push 本地暂存的 TurnC events → Hub writeChain: seq 121-130

结果: 最终事件序列: TurnD (101-120) → TurnC (121-130)
      语义上 TurnD 排在 TurnC 前，即使 TurnC 在 Edge 本地先产生。
```

**边界风险**：如果 TurnC 修改了 TurnD 已修改的文件，会产生**语义冲突**（不是同步冲突）。解决方案：
- Runner 在本地执行 TurnC 前，先检查 SinceSeq 是否落后于 LatestSeq
- 如果落后 → 先拉取 delta → 检测文件冲突 → 提示用户或自动 merge
- 这本质上是 git pull --rebase 的语义

#### Case 3: Compaction 与 In-Flight Sync 的竞态

```
时间线:
  t0: Hub LatestSeq = 1000, events.jsonl 大小 = 2.1MB（刚超过 2MB 阈值）
  t1: Edge-A 发送 SyncRequest{ SinceSeq=900 }
  t2: Hub compact() 触发：
      - 序列化 snapshot (seq=1000)
      - 清空 events.jsonl
      - 追加 EventSnapshotCreated (seq=1001)
  t3: Hub 处理 Edge-A 的 SyncRequest
      - SinceSeq=900 → 但 events.jsonl 已被清空
      - 返回 SyncResponse{ Compacted=true, Snapshot=<snapshot>, LatestSeq=1001 }

结果: Edge-A 收到 Compacted=true → 丢弃本地 events 缓存 → 从 snapshot 重建状态
      → 下次 poll SinceSeq=1001
```

**这是协议设计的正确行为**。`Compacted` 标志确保 Edge 知道事件历史被折叠，需要用完整快照重建。Edge 不应以 SinceSeq=900 去查询已被 compaction 删除的事件。

**边界风险**：如果 compaction 非常频繁（事件速率极高），Edge 可能反复收到 `Compacted=true`，退化为全量同步。缓解：compaction 阈值 2MB 对应约 5000-10000 条事件，在正常速率下足够缓冲。

#### Case 4: Session Resume 的跨进程状态漂移

SDK 模式的 `resume` 字段（02-claude-sdk-impact.md Section 1.4）引入了新问题：SDK session 状态活在 Python 进程内存中。

```
场景:
  t0: Edge-A 启动 Python bridge，创建 ClaudeSDKClient session="abc"
  t1: Edge-A 崩溃，bridge 进程终止 → session "abc" 的上下文丢失
  t2: Edge-B 通过 Hub 的 SyncResponse 看到 seq-based events 继续
  t3: Edge-B 想 resume session "abc" → 但 session 在 Edge-A 的内存中已不存在

问题：seq-based events 同步了"对话内容"，但没有同步"SDK 进程级 session 状态"。
      SDK session resume 需要的不只是事件历史，还需要 SDK 内部的 session token/context。

缓解：
  - Edge 重启后检测 bridge 进程不存在 → 标记所有 active sessions 为 STALE
  - 通过 Hub 的 events 重建消息历史 → 以新 session 方式启动（不 resume）
  - 或：如果 SDK 支持基于事件历史的 resume（从 JSONL 重建上下文），则可 resume
```

#### Case 5: Fork 与 Sync 的语义边界

```
场景:
  t0: Thread T 有 Turn1(seq=1-10), Turn2(seq=11-20)
  t1: 用户 Fork Thread T 从 Turn1 开始 → 创建 Thread T'
  t2: Thread T' 开始新 Turn，产生 events

问题：Thread T' 的 events 应该：
  A. 共享原 Thread T 的 seq 空间（全局单调）→ 并发写入时 seq 交错
  B. 有独立的 seq 空间（per-Thread）→ 违反全局单调

AgentHub 的选择：**B（per-Thread seq）**。
  理由：Thread 是最小的同步单元。不同 Thread 之间天然独立。
  seq 的单调性在 Thread 内保证，跨 Thread 不需要全局排序。
  Hub 端通过 (ProjectID, ThreadID, Seq) 三元组定位事件。
```

---

## 3. LibreChat Message Tree vs AgentHub Linear Seq

### 3.1 两种模型的对立

```
LibreChat 消息树:
  buildTree({ messages, fileMap }) → { message, children[] }
  - 每个节点可以有多个 children（分支/sibling）
  - Branching 是 first-class：从任意消息可以产生新回复
  - SiblingSwitch UI 让用户在兄弟分支间切换
  - 四种 Fork 模式克隆子树到新 conversation

AgentHub seq-based 线性模型:
  events.jsonl → 严格按 seq 排序的事件流
  - 所有事件落入单一线性序列
  - Branching 通过 Fork（创建新 Thread）实现，不在同一 JSONL 中
  - 原 Thread 的 JSONL 保持线性
```

### 3.2 各自的设计取舍

| 维度 | LibreChat Tree | AgentHub Linear Seq |
|------|---------------|-------------------|
| **单会话多分支** | 天然支持（message.children[]） | 不支持——多分支 = 多 Thread |
| **同步简单度** | 需序列化整棵树 + 增量 diff 子树 | 极简：delta = `WHERE seq > since_seq` |
| **离线冲突** | 分支可能冲突（同一 parent 的多个 sibling） | 无冲突（不同 Thread 不同 seq 空间） |
| **历史审计** | 树形遍历，审计路径复杂 | 线性扫描，一目了然 |
| **搜索** | 需要递归遍历树 | 线性扫描 + FTS5 索引 |
| **UI 复杂度** | 需要 SiblingSwitch、分支导航 | 经典聊天 UI 即可 |

### 3.3 AgentHub 的融合方案

AgentHub 不在同一 JSONL 中实现 branching，而是通过 **Thread Fork + Thread 关联** 来实现等效的多分支探索：

```
用户从 Thread T 的 Turn2 重试 → Fork 创建 Thread T':
  Thread T (events_T.jsonl):       Thread T' (events_T'.jsonl):
    Turn1                             Turn1 (复制自 T)
    Turn2 (seq=11-20)                 Turn2 (复制自 T)
    Turn3 (seq=21-30)                 Turn2' (新 Turn，替代 Turn3)
    
Thread T' 的 metadata 记录:
  fork_from: { thread_id: T, turn_id: Turn2, mode: DIRECT_PATH }
  父 Thread 不变，子 Thread 是独立同步单元
```

**为什么不直接在 JSONL 中支持树形结构？**

1. **seq 的线性保证是 EventStore 的核心合约**。在事件流中引入分支会破坏 seq 的单调性和事件回放的确定性。
2. **同步简单度压倒 UI 灵活度**。`delta = events WHERE seq > since_seq` 是同步协议的基石，任何分支结构都会让 delta 计算复杂化（需要遍历整棵树的增量）。
3. **Fork 创建的独立 Thread 反而更干净**：每个 Thread 有独立的生命周期、权限、同步状态，不会互相污染。

---

## 4. 实时协作编辑 Agent Prompt 的可行性

### 4.1 问题定义

"多用户同时编辑同一 Agent prompt" 的冲突域与 "多用户向同一 Thread 追加 Turn" 完全不同：

```
追加 Turn（AgentHub 现有模型）:
  操作粒度：整个 Turn（100-10000 tokens）
  冲突类型：追加操作的顺序
  解决方式：seq 排序，两者都保留

协作编辑 Prompt（新需求）:
  操作粒度：单个字符 / 单词 / 句子
  冲突类型：对同一文本的并发修改
  解决方式：需要 merge 算法（不能简单排序保留两者）
```

### 4.2 三种技术路径

#### Path A: 在 AgentHub 内部实现 CRDT

```
采用 Yjs / Automerge 作为 prompt 编辑的底层 CRDT:

  Yjs 文档 = prompt 文本
  每个 Edge 持有 Y.Doc 副本
  编辑操作通过 Yjs 的 sync protocol 交换
  → 自动解决冲突，无需中心裁决

集成方式:
  AgentHub Hub 端作为 Yjs sync 的中继（类似 y-websocket）
  prompt 的每个版本快照存入 EventStore（整文档级，非操作级）
  seq-based sync 继续负责 Thread/Turn 级同步
  CRDT 仅负责 prompt 文本级同步
```

**优点**: 成熟方案，Yjs 生态丰富，离线编辑自动合并
**缺点**: 引入新依赖（Yjs/WebSocket），两种同步机制并存增加复杂度

#### Path B: 借用 OT（Operational Transformation）

```
类似 Google Docs 的 OT 模型:
  中心 Hub 作为 OT Server
  Edge 发送操作（insert/delete）到 Hub
  Hub 对并发操作做变换后广播

缺点（对 AgentHub 致命）:
  - 需要中心服务器（Hub 必须在线）——违背 Edge-local-first
  - OT 变换矩阵 O(n^2) ——对 prompt 文本（通常 < 1000 字）是过度设计
  - 实现复杂度远高于 CRDT
```

**结论**: 不推荐。OT 适合 Google Docs 级的多用户实时文本编辑，对 Agent prompt 编辑来说太重。

#### Path C: Lock-based 协作（最简单）

```
编辑前获取锁:
  Edge-A 想编辑 Thread T 的 system prompt
  → 发送 LockRequest{ thread_id: T, resource: "prompt" } 到 Hub
  → Hub writeChain: 检查是否有活跃锁
     → 无锁 → 授予锁 (seq=N)，返回 LockGranted{ lock_id, seq }
     → 有锁 → 返回 LockDenied{ holder: Edge-B }

  Edge-A 编辑完成 → 发送 prompt_update event → Hub 释放锁

优点: 零冲突，实现简单，无需 CRDT/OT
缺点: 不支持真正的并发编辑（同一时间只有一个编辑器）
```

### 4.3 推荐方案

```
┌─────────────────────────────────────────────────────────┐
│  AgentHub 分层同步架构                                   │
│                                                          │
│  Layer 1: Thread/Turn 同步 (EventStore seq-based LWW)    │
│    - 粒度: 整个 Turn (event-level)                       │
│    - 协议: SyncRequest/SyncResponse (seq cursor)         │
│    - 冲突: 不存在（append-only, 多 Turn 都保留）         │
│    - 状态: P0 已设计完成                                  │
│                                                          │
│  Layer 2: Prompt 文本同步 (Yjs CRDT)  [P2 可选]          │
│    - 粒度: 字符级编辑 (Y.Text / Y.Map)                   │
│    - 协议: y-websocket / y-sync                          │
│    - 冲突: CRDT 自动合并                                 │
│    - 仅在启用 "协作编辑" 特性时激活                       │
│    - 如果不启用协作编辑，降级为 Lock-based (Layer 2a)     │
│                                                          │
│  Layer 2a: Prompt 编辑锁 (Lock-based)  [P1 建议]         │
│    - 粒度: 整个 prompt 文档                              │
│    - 协议: LockRequest/LockGranted/LockReleased          │
│    - 冲突: 不存在（互斥锁）                               │
│    - 适用场景: 单用户编辑或多用户轮流编辑                  │
│                                                          │
│  Layer 3: 文件同步 (content_pool 去重) [P0]              │
│    - 粒度: 文件级 (SHA-256 内容寻址)                     │
│    - 协议: 引用同步 (refs/ checkpoint 粒度)              │
│    - 冲突: 不存在（不同 Turn 的 checkpoint 独立）        │
│    - 复用 Opcode 模式 (03-eventstore-memory.md Section 2) │
└─────────────────────────────────────────────────────────┘
```

### 4.4 可行性结论

| 场景 | 推荐方案 | 优先级 | 理由 |
|------|---------|:---:|------|
| 多 Tab 查看同一会话 | seq-based sync（现有） | P0 | 只读不需要冲突解决 |
| 多端追加 Turn | seq-based LWW（现有） | P0 | 追加操作不冲突，seq 排序即可 |
| 协作编辑 Prompt（轮流编辑） | Lock-based | P1 | 简单可靠，覆盖 90% 场景 |
| 协作编辑 Prompt（同时编辑） | Yjs CRDT | P2 | 专业场景需要，但非 MVP |
| 实时文件协同编辑 | **不推荐** | - | AgentHub 不是在线 IDE，文件变更由 Turn checkpoint 管理 |

---

## 5. 同步协议的状态机

### 5.1 Edge 端同步状态

```
                    ┌──────────┐
         Start ───> │  IDLE    │
                    └────┬─────┘
                         │ poll timer / user action
                         v
                    ┌──────────┐
          ┌────────>│ SYNCING  │────────┐
          │         └────┬─────┘        │
          │              │              │
          │   Compacted? │   !Compacted │
          │              │              │
          │              v              v
          │    ┌──────────────┐  ┌──────────────┐
          │    │ REBUILDING   │  │  APPLYING    │
          │    │ (full snap)  │  │  (delta)     │
          │    └──────┬───────┘  └──────┬───────┘
          │           │                 │
          │           └────────┬────────┘
          │                    │ success
          │                    v
          │              ┌──────────┐
          └──────────────│   IDLE   │
           error/retry   └──────────┘
```

### 5.2 Hub 端写入路径

```
Edge.A push ──> writeChain ──> { seq++, append events.jsonl }
Edge.B push ──> writeChain ──> { seq++, append events.jsonl }

writeChain 是串行通道（Go channel, buffer=1），保证:
  - 同一时刻只有一个写入者被处理
  - seq 严格单调递增（全局唯一）
  - events.jsonl 的写入顺序 = seq 顺序
  - 不存在两个 Edge 的 events 交错写入（整个 batch 原子）
```

### 5.3 关键不变量

| 不变量 | 保证方式 |
|--------|---------|
| seq 全局单调 | writeChain 串行化 + 内存 seq 计数器 |
| events.jsonl 不可变 | append-only，从不修改已写入行 |
| 同一 Thread 的事件顺序一致 | 所有 Edge 看到相同 seq 对同一 Thread |
| Edge 不会丢失事件 | SinceSeq 轮询 + Compacted 标志重传 |
| Compaction 不丢数据 | compaction 时 snapshot 完整包含截止 seq 的所有状态 |

---

## 6. 与现有设计的衔接

### 6.1 已覆盖的接口

| 接口 | 来源 | 与实时同步的关系 |
|------|------|----------------|
| `EventStore.GetEventsSince(seq)` | 03-eventstore-memory.md | 同步协议的核心查询 |
| `SyncRequest / SyncResponse` | 03-eventstore-memory.md Section 3.5 | 增量同步的消息格式 |
| `AgentAdapter.Resume(sessionID)` | 01-adapters.md Section 2 | 跨进程 session 续传 |
| `SessionManager.ForkSession()` | 01-adapters.md Section 2 | 多分支探索的实现接口 |
| `PermissionBroker` | 01-adapters.md Section 2 | 多端操作的安全围栏 |
| `InteractiveControl.Cancel()/SendSteer()` | 01-adapters.md Section 2 | 跨端控制消息的传输 |

### 6.2 需要新增的

| 新增项 | 说明 | 优先级 |
|--------|------|:---:|
| `LockManager` (Hub 端) | 管理 prompt 编辑的互斥锁 | P1 |
| `PromptSyncService` | Yjs 集成层（协作编辑时启用） | P2 |
| Edge 端 `SyncScheduler` | 定期 poll + 指数退避重试 + 离线队列 | P1 |
| `ConflictDetector` | Turn 执行前检测 seq 落后导致的文件冲突 | P1 |
| `ThreadFork` 的 Sync 语意 | Fork 后新 Thread 的初始 SinceSeq 设定 | P0 |

---

## 7. 决策汇总

| 决策 | 选择 | 排他的替代方案 | 依据 |
|------|------|--------------|------|
| 多端 Turn 冲突 | **seq-based LWW（两者都保留）** | CRDT merge, OT transform, 拒绝后写 | 追加型操作不冲突，seq 排序足矣 |
| 同一 Thread 分支 | **Fork 创建新 Thread** | 单 JSONL 内消息树 | 保持 seq 线性合约 + 独立同步单元 |
| Prompt 协作编辑 | **Lock-based (P1) → CRDT (P2)** | OT, 无协作 | 锁简单覆盖 90%，CRDT 预留专业场景 |
| 离线写入 | **本地暂存 + 重连 push + 冲突检测** | 拒绝离线写入 | Edge-local-first 原则，冲突由 Runner 检测 |
| Compaction 期间同步 | **Compacted 标志 + 全量 snapshot** | 保留足够历史、延迟 compaction | 2MB 阈值保证足够缓冲窗口 |
| SDK session 跨进程 | **不跨 Edge 迁移 session 内存状态** | 序列化 Python 进程状态 | 重建 messages 重放即可，session token 不可序列化 |
| 文件级同步 | **content_pool 引用同步** | 文件 diff/patch | SHA-256 去重天然支持多端共享 |

---

*Analysis complete. 2026-05-21.*
