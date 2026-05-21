# Cross-Analysis: Undo / Rollback / Recovery Mechanisms

> 分析日期: 2026-05-20
> 前置阅读: opcode.md, design-eventstore-memory.md, deep-dive-kanna-orchestrator-mapping.md, librechat.md, deep-dive-librechat-message-tree.md

---

## 1. Undo 粒度矩阵

| 仓库 | 文件级 | 操作级 (Turn/Tool) | 会话级 | 恢复方式 |
|------|:---:|:---:|:---:|---------|
| **Opcode** | 全量文件快照 (SHA-256 + zstd) | message_index 边界 (Smart 策略=每 tool_use) | Fork=新 session 克隆 | 文件覆盖 + 消息清空 + file_tracker 重建 |
| **Kanna** | 无文件回滚 | Fork=transcript 复制 (含 jsonl) | Fork=pendingForkSessionToken 续 session | 复制 transcript + 新 chatId |
| **LibreChat** | 无文件快照 | 无操作级 checkpoint | 4 种 Fork 模式 (message tree 克隆) | 深度克隆 message tree, UUID 重新生成, 时间戳校准 |
| **AgentHub 目标** | 复用 Opcode content_pool | Turn 作为 checkpoint 边界 | Thread 级 Fork + Turn 级 Undo | Event replay + 文件恢复 + FTS5 重建 |

### 核心差异

- **Opcode** 是唯一实现文件级回滚的仓库。其 `CheckpointManager.restore()` 执行: 删除不再属于检查点的文件 -> 递归清理空目录 -> 逐文件恢复 (创建父目录 + 写入内容 + Unix 权限)。去重依赖 SHA-256 content_pool。
- **Kanna + LibreChat** 仅做会话/消息级操作。Kanna 的 Fork 本质是 transcript 浅复制 + 新 session token；LibreChat 的 Fork 是 message tree 深度克隆，所有 `messageId` 重新生成 (UUID v4)，子消息时间戳 +1ms 校准。
- **AgentHub 的差异化**：同时需要文件级 (Runner workspace) 和消息级 (Thread/Turn) 两层回滚。Opcode 的 content_pool 覆盖文件层、Kanna 的 JSONL replay 覆盖事件层。

---

## 2. Checkpoint 触发策略

### 2.1 各仓库策略

| 策略 | Opcode | Kanna | LibreChat | AgentHub 建议 |
|------|--------|-------|-----------|--------------|
| **Manual** | 用户显式创建 checkpoint | - | Fork 按钮触发 | 保留，用于显式 Turn save |
| **PerPrompt** | 每次用户提示后 | Fork=显式操作 | - | **默认策略**：每个 Turn 完成自动 checkpoint |
| **PerToolUse** | 每次工具调用后 (写/编辑/bash/rm/delete) | - | - | 可选，高风险项目启用 |
| **Smart** (Opcode 默认) | 仅破坏性工具后 (write/edit/multiedit/bash/rm/delete) | - | - | AgentHub 不需要——Turn 边界自然提供粒度 |

### 2.2 Opcode 的 Smart 触发判断逻辑 (manager.rs:683-746)

```
PerPrompt → 检查 message.type == "user"
PerToolUse → 检查 message.content 中有 type == "tool_use"
Smart → 检查工具名在 ["write", "edit", "multiedit", "bash", "rm", "delete"] 中
```

### 2.3 AgentHub 简化决策

AgentHub 不需要 Smart 策略——因为 **Turn 边界天然是 checkpoint 边界**。每个 Turn 完成后，state 已经是确定性的：

```
Turn 开始 → Runner 执行工具调用... → Turn 完成
                                        ↓
                              auto_create_checkpoint (PerPrompt)
                              ─ 保存文件快照 (content_pool)
                              ─ 追加 turn_completed event (JSONL)
                              ─ 更新 FTS5 索引
```

**为什么 AgentHub 比 Opcode 简单？** Opcode 需要 Smart 策略来判断"哪些工具调用是破坏性的"，因为它在流式 JSONL 内部没有 Turn 结构。AgentHub 的 Turn 模型天然承载这个边界——Turn 完成即保存点，Turn 内的中间状态不单独 checkpoint。

---

## 3. 恢复时当前状态的保存策略

这是一个关键设计问题：**回滚前，当前未保存的状态如何处置？**

### 3.1 各仓库的做法

| 仓库 | 回滚前的当前状态 | 策略 |
|------|----------------|------|
| **Opcode** | 当前文件+消息直接丢弃 | **Replace 式回滚**：文件被 checkpoint 内容覆盖 (manager.rs:555-564)，current_messages 被清空 (manager.rs:567-571) |
| **Kanna** | 不丢失——Fork 而非回滚 | **Copy-on-Fork**：Fork 创建新 chatId (event-store.ts:746-788)，原 chat 不变 |
| **LibreChat** | 不丢失——Fork 创建全新 conversation | **Fork-is-Clone**：新 conversationId + 新 messageId，原会话独立存在 |
| **AgentHub 建议** | 两种模式并存 | **Undo=Replace (Turn 级小回滚) + Fork=Clone (Thread 级大分支)** |

### 3.2 核心差异：Replace vs Fork

```
Replace (Opcode 模式):
  [Turn A] → [Turn B] → [Turn C] → 回滚到 Turn B
                                         ↓
  当前文件被 Turn B checkpoint 覆盖。Turn C 的文件变更永久丢失。

Fork (Kanna/LibreChat 模式):
  [Turn A] → [Turn B] → [Turn C] → Fork 从 Turn B
                                         ↓
  新 Thread 从 Turn B 开始。原 Thread 保留 Turn C，形成分支。
```

### 3.3 AgentHub 双模式设计

```
AgentHub Undo = Replace (Turn 级)
  适用场景：用户说"上一轮的回答不好，回退"。
  实现：restore_files(checkpoint_id) + 从 event log 中标记 turn_c 为 cancelled
  当前 Turn C 的状态：文件回滚，Turn 标记 cancelled（不删除 event，保留审计）

AgentHub Fork = Clone (Thread 级)
  适用场景：用户说"从 Turn B 重新开始一个新的探索方向"。
  实现：create_thread(root_message_id=turn_b.message_id, fork_mode=INCLUDE_BRANCHES)
  当前 Thread 保留 Turn C 不动。新 Thread 从 Turn B fork。
```

**为什么需要两种？** Undo 用于快速修正 (低心智负担)，Fork 用于保留探索历史 (不丢失分支)。两者服务于不同的用户意图。

---

## 4. AgentHub Undo 设计：对齐 Project/Thread/Turn 模型

### 4.1 核心原则

1. **Turn 是最小不可分割单元**：一个 Turn 内不做 checkpoint，Turn 完成后整体原子化
2. **Undo 针对 Turn 边界，不针对 Turn 内的中间步骤**
3. **Fork 针对 Thread 边界，保留完整分支历史**
4. **文件快照 (content_pool) 为 Turn checkpoint 服务，消息事件 (JSONL) 为审计/回放服务**

### 4.2 数据模型

```
Project
  └── Thread (open | running | blocked | done | archived)
        ├── Turn 1 [checkpoint_id=A]   ← 根 checkpoint
        ├── Turn 2 [checkpoint_id=B]
        ├── Turn 3 [checkpoint_id=C]   ← 当前
        └── ...
              │
              ├── events.jsonl          ← EventStore SSOT (append-only)
              │     ├── {"v":2, "type":"thread_created", ...}
              │     ├── {"v":2, "type":"turn_started", "turn_id":"T1", ...}
              │     ├── {"v":2, "type":"turn_completed", "turn_id":"T1", "checkpoint_id":"A"}
              │     ├── {"v":2, "type":"turn_started", "turn_id":"T2", ...}
              │     ├── {"v":2, "type":"turn_completed", "turn_id":"T2", "checkpoint_id":"B"}
              │     └── ...
              │
              └── .checkpoints/         ← Opcode 风格 content-addressed storage
                    ├── content_pool/
                    │     ├── {sha256_a}      ← zstd 压缩文件内容
                    │     └── {sha256_b}
                    └── refs/
                          └── {checkpoint_id}/
                                └── {safe_filename}.json  ← {path, hash, is_deleted}
```

### 4.3 Undo (Turn 级回滚)

**触发条件**：用户对 Thread 中的某个 Turn 执行 Undo

**流程**：

```
Undo(turn_id=T3, target_turn_id=T1):
  1. 加载 T1 对应的 checkpoint (checkpoint_id=A)
  2. 加载文件快照引用列表 (refs/A/*.json)
  3. 当前文件变更状态：
     a. 不保存 T2+T3 的文件变更（Undo 语义是丢弃）
     b. 直接将 workspace 文件恢复到 checkpoint A 的状态
     c. 删除 T2+T3 创建的孤儿文件
     d. 递归清理空目录
  4. Event 层处理：
     a. 追加 turn_undone event: {"v":2, "type":"turn_undone", "turn_id":"T3", "target":"T1"}
     b. 追加 turn_undone event: {"v":2, "type":"turn_undone", "turn_id":"T2", "cascade":true}
     c. 追加 turn_started event 标记新起点
     d. T2+T3 的原始 event **不删除**——保留在 JSONL 中供审计
  5. FTS5 层：标记 T2+T3 的 messages 为 archived（不删除索引，搜索时默认排除）
  6. 重置 Thread.CurrentTurnID → null（等待下一个 Turn）
```

**关键决策**：T2+T3 的 events **不物理删除**。JSONL append-only 的不可变性是 Event Sourcing 的核心保证——删除是对 SSOT 的破坏。`turn_undone` 作为补偿事件标记逻辑状态，与 `turn_cancelled` 同为终止事件。

### 4.4 Fork (Thread 级分支)

**触发条件**：用户从某个 Turn 创建新 Thread

**复用 LibreChat 的 Fork 模式**：

```
Fork(from_thread=T1, from_turn=T3, mode=fork_mode):
  
  模式选择（对齐 LibreChat ForkOptions）：
  
  DIRECT_PATH:
    仅复制根 Turn → T1 → T2 → T3 的直接父链
    新 Thread 只有线性历史，不含兄弟分支
  
  INCLUDE_BRANCHES (推荐默认):
    复制从根到 T3 的所有消息，含所有兄弟分支
    新 Thread 保留完整消息树上下文
  
  TARGET_LEVEL (简化实现):
    复制 T3 所在层级及以上所有 Turn
    不包含更深子孙（如果存在 sub-thread）
  
  Fork 实现：
  1. 创建新 Thread (新 ThreadID)，RootMessageID=turn_b_msg
  2. 创建新 Thread 的 events 流（独立 JSONL）
  3. 深度克隆消息：所有 messageId 重新生成
  4. 时间戳重新校准（子消息时间 > 父消息时间）
  5. 文件快照：新 Thread 共享 content_pool（SHA-256 天然去重）
  6. checkpoint 引用：Fork 时复制 refs 到新 checkpoint_id（引用而非复制文件内容）
```

**Fork 时的文件状态**：
- 新 Thread 可以克隆当前 workspace 状态作为起点
- 或从原 Thread 的 checkpoint 恢复（更干净）
- 建议默认后者：`Fork → restore checkpoint → 新 Thread 在干净的文件状态上开始`

### 4.5 恢复时的 Checkpoint 选择

```
Thread 的 Checkpoint 链：
  Turn 1 [ckpt_A, parent=none]
    └── Turn 2 [ckpt_B, parent=ckpt_A]
          └── Turn 3 [ckpt_C, parent=ckpt_B]
                └── Turn 4 (进行中，无 checkpoint)

Undo 回退到 Turn 2：
  → 加载 ckpt_B + 加载其所有文件的 content_pool refs
  → 恢复 workspace 文件到 ckpt_B 状态
  → 追加 turn_undone(Turn3) + turn_undone(Turn4,cascade) events

Fork 从 Turn 2 开始：
  → 创建新 Thread, 复制 Turn1+Turn2 的 events
  → 新 Thread 的 checkpoint 链: ckpt_A' → ckpt_B' (引用相同 content_pool)
  → 原 Thread 继续从 Turn 4 完成不受影响
```

### 4.6 与各仓库的差异总结

| 维度 | Opcode | Kanna | LibreChat | AgentHub |
|------|--------|-------|-----------|----------|
| 回滚粒度 | message_index | 无 | 无 | **Turn** (天然边界) |
| 分支粒度 | session tree | chat Fork | conversation Fork | **Thread Fork** + ForkMode |
| 文件恢复 | content-addressed | 无 | 无 | content-addressed（复用 Opcode） |
| 事件保留 | JSONL 覆盖 | 不删除 | 不删除 | **不删除**——append turn_undone 补偿事件 |
| 当前状态 | 直接丢弃 | Fork 保留 | Fork 保留 | **双模式**：Undo 丢弃 / Fork 保留 |
| 策略复杂度 | 4 种 auto 策略 | 无 | 无 | **简化为 PerPrompt (默认)** |

---

## 5. 实现优先级

| 优先级 | 功能 | 来源 | 说明 |
|--------|------|------|------|
| P0 | EventStore JSONL + append-only `turn_undone` 事件 | Kanna + Opcode | Undo 的 SSOT 基础，补偿事件而非物理删除 |
| P0 | content_pool 文件快照 (SHA-256 + zstd) | Opcode | 文件级回滚的去重存储 |
| P0 | `restore_checkpoint(checkpoint_id)` 文件恢复 | Opcode manager.rs:452-599 | 核心 Undo 逻辑 |
| P1 | Thread Fork (INCLUDE_BRANCHES + DIRECT_PATH) | LibreChat fork.js | Thread 级分支探索 |
| P1 | Fork 时深度克隆 messageId 重新生成 | LibreChat | 独立 Thread 需要独立消息 ID |
| P1 | FTS5 层 `archived` 标记（undo 的 Turn 排除搜索） | Claude Code Viewer | 被 undo 的 Turn 保留但不主动出现 |
| P2 | 多个 Thread 间共享 content_pool | Opcode | Fork 的 Thread 共享相同文件内容，天然去重 |
| P2 | Checkpoint 级 Diff（文件级 + Turn 级语义 diff） | Opcode TimelineNavigator | 对比 checkpoint 间差异 |

---

## 6. 不采纳的特性

| 特性 | 仓库 | 原因 |
|------|------|------|
| Smart / PerToolUse checkpoint 策略 | Opcode | Turn 边界天然覆盖，无需细粒度工具级策略 |
| Snapshot compaction (2MB 阈值) | Kanna | EventStore 的 compaction 用于存储效率，不是 Undo 机制。EventStore 设计已独立讨论 (design-eventstore-memory.md) |
| Context Pruning / Summarization | LibreChat | 属于 Memory 层而非 Undo 层，Memory 设计已独立讨论 |
| SiblingSwitch UI | LibreChat | 前端交互细节，暂不纳入持久化层设计 |
| TARGET_LEVEL / DEFAULT Fork 模式 | LibreChat | DIRECT_PATH + INCLUDE_BRANCHES 覆盖核心场景，简化模式菜单 |
