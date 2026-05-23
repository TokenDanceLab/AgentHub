# AgentHub 键盘快捷键系统 -- 设计规格

> 依据: `design-desktop-ux.md`、`opcode.md`（已分析源码）、`kanna.md`、`cloudcli.md`
> 日期: 2026-05-21
> 状态: 草稿 v1.0

---

## 1. 设计原则

1. **修饰键自适应**: Windows/Linux 上为 `Ctrl`，macOS 上为 `Cmd`。以下所有规格以 `Ctrl` 为代表。
2. **范围激活**: 快捷键分发到获得焦点的上下文层，而非全局吞噬。
3. **可发现**: Command Palette（`Ctrl+K`）展示所有操作及其绑定的快捷键。
4. **Vim/J 风格导航**: 聚焦面板中使用 `j/k` 进行列表导航，`n/p` 进行文件级上一项/下一项移动。
5. **不与编辑器修饰键冲突**: 聊天输入和 Diff 审阅快捷键谨慎使用修饰键，避免与 Monaco/textarea 原生行为冲突。

---

## 2. 快捷键层

AgentHub 将快捷键组织为 7 个范围层。每一层仅在其目标 DOM 区域获得焦点或父视图活跃时激活。

| 层 | 范围 | 激活条件 |
|-------|-------|------------|
| `global` | 整个应用（桌面外壳） | 始终，除非输入框获得焦点 |
| `tab-mgmt` | 标签栏 | 当 `view === "tabs"` 且无输入框焦点 |
| `chat-input` | ComposeArea textarea | 当 textarea 获得焦点 |
| `message-tree` | CenterChat MessageTree | 当消息列表容器获得焦点 |
| `diff-review` | RightPanel Diff 标签页 | 当 DiffPanel 是活跃的右侧面板标签页 |
| `file-tree` | RightPanel Files 标签页 | 当 FileTreeBody 获得焦点 |
| `code-editor` | Monaco/CodeMirror | 当编辑器容器获得焦点 |

---

## 3. 快捷键清单

### 3.1 全局层（桌面）

| 快捷键 | 操作 | 冲突检查 |
|----------|--------|----------------|
| `Ctrl+K` | 打开 Command Palette / 全局搜索 | 无原生冲突 |
| `Ctrl+,` | 打开设置 | 无原生冲突 |
| `Ctrl+B` | 切换左侧 sidebar | 无原生冲突 |
| `Ctrl+J` | 切换右侧面板 | VS Code `Ctrl+J` 是终端；AgentHub 使用 `Ctrl+\` 作为终端 |
| `Ctrl+\` | 切换终端（右侧面板） | VS Code 惯例 |
| `Ctrl+Shift+F` | 聚焦全局搜索（`Ctrl+K` 备用） | VS Code 惯例 |
| `F11` | 切换全屏（Tauri） | 标准 |
| `Escape` | 关闭最顶层模态框 / 覆盖层 / 取消焦点 | 标准 |

### 3.2 标签管理层（Opcode 派生）

| 快捷键 | 操作 | 备注 |
|----------|--------|-------|
| `Ctrl+T` | 新建聊天标签页 / 新 Thread | Opcode 来源；通过 `CustomEvent` 分发 |
| `Ctrl+W` | 关闭活跃标签页 | Opcode 来源 |
| `Ctrl+Tab` | 下一个标签页（向右循环） | Opcode 来源 |
| `Ctrl+Shift+Tab` | 上一个标签页（向左循环） | Opcode 来源 |
| `Ctrl+1` 到 `Ctrl+9` | 按 1-index 位置切换标签页 | Opcode 来源。`Ctrl+0` = 最后一个标签页 |

### 3.3 聊天输入层

| 快捷键 | 操作 | 备注 |
|----------|--------|-------|
| `Enter` | 发送消息 | 仅当非 IME 组合中。若展开输入区，不要求按 `Shift`。 |
| `Shift+Enter` | 插入换行 | 标准 |
| `Ctrl+Shift+Enter` | 带审批确认发送 | 对破坏性提示词的安全关卡 |
| `Escape` | 取消焦点 / 关闭 @mention 弹出框 / 关闭文件选择器 | Opcode 模式（FloatingPromptInput） |
| `Ctrl+V` | 粘贴（带图片检测） | 将图片粘贴为内联附件 |
| `@` | 触发 @mention 弹出框 | 字符触发，非组合键 |
| `/` | 触发斜杠命令选择器 | Opcode 模式（SlashCommandPicker） |
| `Ctrl+Shift+E` | 展开/折叠输入区域 | Opcode 模式 |

### 3.4 消息树导航层

| 快捷键 | 操作 | 备注 |
|----------|--------|-------|
| `j` / `ArrowDown` | 下一条消息（滚动到可见） | 仅当消息列表获得焦点 |
| `k` / `ArrowUp` | 上一条消息 | 仅当消息列表获得焦点 |
| `Enter` | 展开/折叠已聚焦消息（Thinking、ToolUse） | 渐进式展开 |
| `Space` | 切换展开/折叠光标下的工具结果 | Enter 的替代 |
| `Shift+Enter` | 在 RightPanel 中打开已聚焦的 diff | 当已聚焦消息含 diff 时 |
| `Escape` | 折叠所有展开层 / 焦点返回输入框 | Kanna 模式（keybinding action） |
| `Ctrl+Enter` | 批准 / 提交内联审批卡片 | 当审批卡片获得焦点 |

### 3.5 Diff 审阅层

| 快捷键 | 操作 | 备注 |
|----------|--------|-------|
| `n` | Diff 文件列表中的下一个文件 | Vim 惯例（`n`ext） |
| `p` | Diff 文件列表中的上一个文件 | Vim 惯例（`p`revious） |
| `j` | 当前文件中的下一个 hunk | 相对于已聚焦 diff 的上下文 |
| `k` | 当前文件中的上一个 hunk | |
| `Enter` | 展开/折叠当前文件 diff | |
| `Ctrl+Enter` | 应用当前 hunk | 来自 design-desktop-ux DiffCard |
| `Ctrl+Shift+Enter` | 应用当前文件中所有 hunk | |
| `Ctrl+A` | 选择所有已暂存文件 | |
| `Escape` | 关闭 diff / 返回聊天 | |
| `Ctrl+M` | 生成 AI commit message | 来自 CloudCLI 模式 |
| `Ctrl+Shift+M` | 使用生成/输入的 message 提交 | |

### 3.6 文件树层

| 快捷键 | 操作 | 备注 |
|----------|--------|-------|
| `ArrowUp/Down` | 导航文件树节点 | |
| `ArrowRight` | 展开目录 | |
| `ArrowLeft` | 折叠目录 | |
| `Enter` | 打开文件（在右侧面板中打开 diff） | |
| `Space` | 切换展开/折叠目录 | |
| `Ctrl+N` | 新建文件对话框 | VS Code 惯例 |
| `Ctrl+Shift+N` | 新建文件夹对话框 | VS Code 惯例 |
| `F2` | 重命名已聚焦的文件/目录 | 标准 |
| `Delete` | 删除已聚焦的文件/目录（确认模态框） | |
| `Ctrl+C` | 复制文件路径到剪贴板 | 当树项目获得焦点时，非文本选择 |

### 3.7 代码编辑器层（Monaco 继承）

继承 Monaco 默认快捷键。AgentHub 覆盖项：

| 快捷键 | 操作 | 备注 |
|----------|--------|-------|
| `Ctrl+S` | 保存（如果 artifact 可编辑） | 标准 |
| `Ctrl+Shift+S` | 另存为新版本 | AgentHub 特有 |
| `Ctrl+Shift+R` | 在 RightPanel Preview 标签页中打开 artifact 预览 | |
| `Ctrl+Shift+D` | 打开 agent diff 对比 | 并排对比 agent 输出 |

---

## 4. 右侧面板标签页快速切换

当右侧面板打开时，数字键不加修饰键即可切换标签页。映射遵循标签栏顺序：

| 按键 | 标签页 |
|-----|-----|
| `1` | Files |
| `2` | Diff |
| `3` | Preview |
| `4` | Git |
| `5` | Logs |
| `6` | Terminal |

仅当右侧面板获得焦点时生效（聊天输入获得焦点时不消费）。

---

## 5. 实现架构

### 5.1 事件分发模型（Opcode 模式）

遵循 Opcode 通过 `window` 的 `CustomEvent` 分发用于标签管理。层感知快捷键在已聚焦组件中使用 React `onKeyDown`。

```
Global layer:    window.addEventListener('keydown', ...)
                 → 分发到 action registry
Tab layer:       customEvents（'create-chat-tab'、'close-current-tab'、...）
Chat input:      在 textarea 上的 React onKeyDown
Message tree:    在消息列表容器上的 React onKeyDown
Diff/File/Editor: 在面板容器上的 React onKeyDown
```

### 5.2 Hook 架构

```ts
// src/hooks/useKeyboardShortcuts.ts
function useKeyboardShortcuts(layer: ShortcutLayer, bindings: ShortcutBinding[]) {
  // 返回给定层的 { register, unregister }
  // 非全局层：通过 onKeyDown 绑定到容器 ref
  // 全局层：使用 layer filter 绑定到 window keydown
}

// src/hooks/useGlobalShortcuts.ts
function useGlobalShortcuts(bindings: ShortcutBinding[]) {
  // 应用级绑定：Ctrl+K、Ctrl+,、Ctrl+B、Ctrl+J、Ctrl+\、F11、Escape
}
```

### 5.3 快捷键注册表与用户覆盖

```ts
// src/lib/shortcuts.ts
interface ShortcutBinding {
  id: string                      // 唯一操作 ID，如 "global.toggle-sidebar"
  layer: ShortcutLayer
  keys: string                    // "Ctrl+B"
  action: () => void
  label: string                   // "Toggle Sidebar"
  description?: string
  disabled?: () => boolean        // 运行时守卫
}

// 从 Settings > ShortcutSettings 面板读取
// 存储在 localStorage："ah_shortcuts_overrides"
```

### 5.4 冲突解决

- 编辑器层（Monaco）首先消费标准编辑快捷键（`Ctrl+S`、`Ctrl+F`、`Ctrl+/`），阻止全局传播。
- 聊天输入捕获 `Enter` / `Escape` / `@` / `/` 后再到达全局层。
- 全局 `Ctrl+K` 在 textarea 获得焦点时永不触发（通过 `document.activeElement` 标签检查）。
- 标签页 `Ctrl+W` 在 agent 响应进行中时不关闭浏览器/标签页；改为显示确认对话框。

---

## 6. 仅桌面 vs 跨平台

| 范围 | 桌面（Tauri） | Web |
|-------|----------------|-----|
| `Ctrl+T/W/Tab/1-9` | 是 | 是（注意：`Ctrl+W` 可能关闭浏览器标签页；通过 `e.preventDefault()` 拦截） |
| `Ctrl+K` | 是 | 是 |
| `Ctrl+B` / `Ctrl+J` / `Ctrl+\` | 是 | 是 |
| `F11` | 是（Tauri 全屏） | 浏览器原生，不拦截 |
| 通过 Tauri 插件的全局快捷键 | `global-shortcut` 插件 | N/A |
| `Ctrl+Shift+I`（DevTools） | Tauri：禁用 | 浏览器：原生 |
| 文件树 `Ctrl+N` | 是 | 是 |

**注意**: 在 Web 上，`Ctrl+W` 必须无条件 `preventDefault()` 以避免关闭浏览器标签页。Tauri 桌面无此风险。

---

## 7. 参考资料摘要

| 来源 | 导入的模式 |
|--------|------------------|
| **Opcode**（`App.tsx:101-141`、`TabManager.tsx:171-224`） | 标签管理快捷键（`Ctrl+T/W/Tab/1-9`）、CustomEvent 分发模型、`Ctrl+Shift+E` 展开输入、Escape 关闭选择器 |
| **Kanna**（`kanna.md:68`） | 全局 keydown 监听器匹配 keybinding action、每操作切换语义（切换终端、切换 sidebar） |
| **CloudCLI**（`cloudcli.md:34-43`） | `Ctrl+M` AI commit message 生成模式、无应用级快捷键冲突 |
| **design-desktop-ux.md** | `Ctrl+K` command palette、`Ctrl+Enter` 评论提交、`Enter`/`Shift+Enter` 输入语义、`Ctrl+N` 新建文件 |
| **VS Code / Monaco** | `Ctrl+\` 终端、`Ctrl+B` sidebar、`Ctrl+J` 面板切换、`Ctrl+,` 设置、编辑器原生快捷键 |
