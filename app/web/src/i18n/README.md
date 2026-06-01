# AgentHub Web i18n 翻译规范

## 技术栈

- [react-i18next](https://react.i18next.com/) + [i18next](https://www.i18next.com/)
- 语言切换：右上角设置面板 → 中/英
- 持久化：`localStorage` key `agenthub-language`
- 命名空间：`common | status | workbench | agentSquare | privateChats | groupWorkspace | project`

## 快速上手

```tsx
import { useTranslation } from 'react-i18next';

// 页面内
const { t } = useTranslation('workbench');
<span>{t('header.title')}</span>
```

```tsx
// 普通文本
{t('status.label')}

// 带插值
{t('chat.result.success', { input: 245, output: 180 })}

// aria-label
<button aria-label={t('action.approve')}>

// placeholder
<input placeholder={t('prompt.placeholder')}>

// 跨命名空间引用
{t('common:action.send')}
```

## 术语表

### 统一译名

| EN | 统一中译 |
|---|---|
| Workbench | 工作台 |
| Project | 项目 |
| Thread | 线程 |
| Conversation | 会话 |
| Workspace | 工作区 |
| Approval | 审批 |
| Artifact | 产物 |
| Preview | 预览 |
| Approve / Reject | 批准 / 拒绝 |
| Apply / Discard | 应用 / 丢弃 |
| Send | 发送 |
| Cancel | 取消 |
| Pending | 待定 |
| Online / Offline | 在线 / 离线 |
| Idle | 空闲 |
| Running | 运行中 |
| Queued | 已排队 |
| Failed | 失败 |
| Finished / Completed | 已完成 |

### 专有名词（保留英文，绝不翻译）

```
Agent / Agents          AgentHub
AgentRun                Token / Tokens
Edge / Edge Server      Runner
Hub / Hub Server        Diff
WebSocket / WS          MCP
Claude Code / Codex / OpenCode
REST / API / SSE / RPC
Markdown                JSON / YAML
@mention                stdout / stderr
checkpoint              hunk
```

### 遇到术语表外的新词

先在本文档的术语表里**加一行**，再翻译，避免一词多译。

## 不翻译的内容

- 类名 / className
- data-* 属性
- 调试日志 console.log(...)
- 代码注释
- 工具调用名 / 事件类型 ID（`'message.delta'`、`'run.queued'`）
- 已在专有名词清单里的词

## 扫描漏网之鱼

```powershell
Select-String -Path "app/web/src/pages/workbench/WorkbenchPage.tsx" `
  -Pattern '(aria-label|placeholder|title|alt)="[A-Z][a-z]'
```

匹配到的几乎都是遗漏的英文字符串。用实际页面路径替换。
