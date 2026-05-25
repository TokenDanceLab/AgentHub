# LobeHub Icons — Full Audit & Migration Guide for AgentHub Desktop

> Source: `reference/lobehub/` + AgentHub Desktop `app/desktop/src/`
> Package: `@lobehub/icons` v5.x
> Author: Researcher 3 — LobeHub Icons Full Audit
> Date: 2026-05-25

---

## 1. Executive Summary

AgentHub Desktop currently uses **lucide-react exclusively** for all icons. While lucide-react is excellent for general UI icons, it has **zero AI-specific icons** — no model icons, no provider logos, no AI brand marks. The `@lobehub/icons` package fills this gap with hundreds of AI-specific SVG icons.

**Key takeaway**: Migrate to a hybrid approach — lucide-react for general UI (arrows, toggles, actions) + @lobehub/icons for AI-specific (models, providers, brands). This will dramatically improve the visual identity of AgentHub as an AI-native desktop app.

---

## 2. @lobehub/icons — Package Overview

### 2.1 Package Info

- **Package**: `@lobehub/icons` v5.x
- **Repository**: https://github.com/lobehub/lobe-icons
- **CDN**: Static SVG icons available at `https://npm.webp.se/cdn/@lobehub/icons/`
- **Peer dependency**: React 18+
- **Style**: Colorful SVG icons (not monochrome icon font)

### 2.2 How lobehub Uses the Icons (from ModelSelect component)

```tsx
import { type IconAvatarProps } from '@lobehub/icons';
import { LobeHub, ModelIcon, ProviderIcon } from '@lobehub/icons';
import { Avatar, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';

// Provider icon with type and size
<ProviderIcon provider="openai" size={20} type="avatar" />

// Model icon with model ID and size
<ModelIcon model="gpt-4" size={20} />

// Using icons in list items with labels
<LabelRenderer Icon={ModelIcon} label="GPT-4" />
```

### 2.3 Key Components

| Component | Purpose | Props |
|-----------|---------|-------|
| `ModelIcon` | Display a specific AI model's icon | `model: string`, `size?: number`, `type?: 'avatar' \| 'icon'` |
| `ProviderIcon` | Display an AI provider's logo | `provider: string`, `size?: number`, `type?: 'avatar' \| 'icon'` |
| `ProviderCombine` | Display combined provider info | `provider: string`, `size?: number` |
| `LobeHub` | LobeHub platform logo | `size?: number` |
| `IconAvatarProps` | Type for icon component props | `size: number`, `type?: string` |

### 2.4 Supported Models & Providers

Based on the lobehub codebase, @lobehub/icons supports hundreds of models and providers across these categories:

**Providers** (partial list):
- anthropic, openai, google, meta, mistral, cohere, deepseek
- moonshot, zhipu, baichuan, qwen, minimax, 01.ai
- aws, azure, cloudflare, together, fireworks, groq, perplexity
- ollama, lmstudio, vllm, openrouter, replicate, huggingface
- And many more...

**Models** (partial list):
- claude-*, gpt-*, gemini-*, llama-*, mistral-*, deepseek-*, qwen-*, glm-*
- All Claude models: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5, etc.
- All GPT models: gpt-5.5, gpt-4o, gpt-4-turbo, etc.

### 2.5 CDN-Based SVG Icons

LobeHub also provides static SVG icon URLs for AI brands:
```
https://npm.webp.se/cdn/@lobehub/icons/{category}/{name}.svg
```

Categories include:
- `providers/` — Provider brand logos
- `models/` — Model-specific icons
- `llm-brands/` — LLM brand marks
- `ai-brands/` — AI company logos
- `plugin-brands/` — Plugin/tool brand marks

---

## 3. Current AgentHub Desktop Icon Usage — Full Audit

### 3.1 WelcomeScreen.tsx — 16 lucide-react icons

| Current Icon | Usage | Assessment |
|-------------|-------|------------|
| `Sparkles` | Brand mark, profile icon | Keep (AI sparkle) |
| `Cpu` | Runtime mode tab | Keep (computing metaphor) |
| `Bot` | Profile mode tab, agent icons | Keep (agent metaphor) OR replace with agent-specific LobeHub icon |
| `Route` | Target mode tab | Keep (routing metaphor) |
| `Braces` | Suggestion chips | Keep (code/JSON) |
| `CheckCircle2` | Target status confirmation | Keep |
| `MessageSquareText` | Command input button | Keep |
| `HardDrive` | Local edge indicator | Keep |
| `LockKeyhole` | Approval indicator | Keep |
| `Cloud` | TokenDance cloud indicator | Replace with TokenDance brand icon |
| `Server` | Runner count indicator | Keep |
| `Wifi` | Online status | Keep |
| `WifiOff` | Offline status | Keep |

### 3.2 SettingsPage.tsx — 35+ lucide-react icons

| Current Icon | Section/Usage | Assessment |
|-------------|--------------|------------|
| `SlidersHorizontal` | General, Models | Keep |
| `Palette` | Appearance | Keep |
| `Wrench` | Configuration | Keep |
| `UserCircle` | Personalization, Account | Keep |
| `ShieldCheck` | Permissions, Security, Callout | Keep |
| `Bot` | Agent Profiles, Agent Market | **REPLACE** with agent-specific icons or multiple agent icons |
| `Server` | Execution Targets | Keep |
| `ClipboardList` | Tasks | Keep |
| `Globe2` | Online IM, Connections, etc. | Keep |
| `MessageSquareText` | Group Chat | Keep |
| `Route` | Agent Scheduling | Keep |
| `Keyboard` | Keyboard | Keep |
| `Plug` | MCP, ccSwitch | Keep |
| `Code2` | Skills, Market | Keep |
| `TerminalSquare` | Hooks | Keep |
| `Link2` | Model Mapping | Keep |
| `Computer` | Remote Control, Computer Use | Keep |
| `GitBranch` | Git | Keep |
| `FolderGit2` | Worktree | Keep |
| `Eye` | Browser, Mode card | Keep |
| `HardDrive` | Environment | Keep |
| `Monitor` | Platforms, Targets, etc. | Keep |
| `LockKeyhole` | Account, Security | Keep |
| `Archive` | Archived | Keep |
| `ArrowLeft` | Back button | Keep |
| `ChevronRight` | Setting rows with action | Keep |
| `Check` | Mode card checkmark | Keep |
| `RefreshCw` | Refresh runs | Keep |
| `XCircle` | Cancel run | Keep |
| `LogIn` | Sign in | Keep |
| `LogOut` | Sign out | Keep |

### 3.3 App.tsx — 15+ lucide-react icons

| Current Icon | Usage | Assessment |
|-------------|-------|------------|
| `AlertTriangle` | Warning/error indicators | Keep |
| `ClipboardList` | Task panel | Keep |
| `Circle` | Hub connection status | Keep |
| `Copy` | Share workspace | Keep |
| `MessageSquareText` | Toggle IM/Agent view | Keep |
| `LogIn` | Hub login on rail | Keep |
| `Maximize2` / `Minimize2` | Workspace expand/collapse | Keep |
| `Menu` | Mobile menu | Keep |
| `Minus` / `Square` / `X` | Window controls | Keep |
| `Moon` / `Sun` | Theme toggle | Keep |
| `PanelLeftClose` / `PanelLeftOpen` | Sidebar collapse | Keep |
| `PanelRightClose` / `PanelRightOpen` | Right panel toggle | Keep |
| `Route` | Scheduling button | Keep |
| `Search` | Sidebar search | Keep |
| `Settings` | Settings button | Keep |
| `Wifi` / `WifiOff` | Connection status | Keep |

### 3.4 ChatView.tsx — 5 lucide-react icons

| Current Icon | Usage | Assessment |
|-------------|-------|------------|
| `Copy` | Copy message | Keep |
| `RefreshCw` | Retry message | Keep |
| `Trash2` | Delete message | Keep |
| `ArrowDown` | Scroll to bottom | Keep |
| `MessageSquare` | Chat indicator | Keep |

### 3.5 Tool Call Icons (emoji-based, in ChatView.tsx)

```typescript
const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '✏️',
  Bash: '⚡', Grep: '🔍', Glob: '📂',
  WebFetch: '🌐', WebSearch: '🌐',
  Task: '🤖', TodoWrite: '✅',
};
```

**Assessment**: Emoji tool icons are inconsistent across platforms and feel unprofessional. These should be replaced with proper SVG icons.

---

## 4. Migration Plan — Specific Replacements

### 4.1 HIGH PRIORITY — AI-Specific Icons

These are places where @lobehub/icons provides clearly superior alternatives:

| Current | File | Replace With | Why |
|---------|------|-------------|-----|
| No AI icon at all | App.tsx top bar | `ProviderIcon provider="anthropic"` or `ModelIcon model="claude-sonnet-4-6"` | Show active model/provider |
| Generic `Bot` for agent cards | WelcomeScreen, SettingsPage, AgentList | `ProviderIcon` based on agent's runtime type | Visual distinction between Claude/Codex/Gemini agents |
| No model icon | ModelDropdown.tsx | `ModelIcon model={modelId}` | Show model brand icon next to model name |
| No provider icon | SettingsPage models section | `ProviderIcon provider={providerId}` | Show provider logo in model mapping rows |
| `Cloud` for TokenDance | WelcomeScreen | TokenDance brand icon (custom or from LobeHub CDN) | Brand consistency |
| Emoji tool icons | ChatView.tsx | Proper SVG icons from lucide-react or custom | Professional appearance, cross-platform consistency |

### 4.2 MEDIUM PRIORITY — Enhancement Opportunities

| Location | Add | Benefit |
|----------|-----|---------|
| Settings → Models section | `ModelIcon` for each model option in dropdown | Visual model identification |
| Settings → Model Mapping | `ProviderIcon` for each provider row | Brand recognition |
| Settings → ccSwitch | `ProviderIcon` for each provider health row | Provider identity |
| AgentList sidebar | `ProviderIcon` next to agent names | Agent type recognition |
| WelcomeScreen runtime list | `ProviderIcon` instead of generic `Bot` | User can see which runtime they're selecting |
| ThreadPanel | Icons for thread type (code review, feature, bugfix) | Thread categorization |

### 4.3 KEEP AS-IS — lucide-react icons

These icons are correct and should stay:
- All window controls (Minus, Square, X)
- Navigation arrows (ArrowLeft, ChevronRight)
- Action icons (Copy, RefreshCw, Trash2)
- Status indicators (Wifi, WifiOff, Circle)
- Theme toggle (Moon, Sun)
- UI controls (Search, Menu, Settings)
- Standard metaphors (LockKeyhole, ShieldCheck, Palette, Keyboard)

---

## 5. Implementation Guide

### 5.1 Installation

```bash
pnpm add @lobehub/icons
```

### 5.2 Basic Usage

```tsx
import { ModelIcon, ProviderIcon, ProviderCombine } from '@lobehub/icons';

// In model selector dropdown
<ModelIcon model="claude-sonnet-4-6" size={20} />

// In provider configuration
<ProviderIcon provider="anthropic" size={24} type="avatar" />

// In agent card (combined provider info)
<ProviderCombine provider="anthropic" size={24} />
```

### 5.3 Type-Safe Wrappers

Create wrapper components for type-safe usage:

```tsx
// src/components/icons/AgentProviderIcon.tsx
import { ProviderIcon } from '@lobehub/icons';
import type { AgentInfo } from '@shared/types';

export function AgentProviderIcon({ agent, size = 20 }: { agent: AgentInfo; size?: number }) {
  const provider = mapAgentToProvider(agent);
  if (!provider) return <Bot size={size} />; // fallback to lucide-react
  return <ProviderIcon provider={provider} size={size} />;
}

function mapAgentToProvider(agent: AgentInfo): string | null {
  // Map agent IDs to LobeHub provider keys
  const mapping: Record<string, string> = {
    'claude-code': 'anthropic',
    'codex': 'openai',
    'gemini-cli': 'google',
    'opencode': 'opencode',
  };
  return mapping[agent.id] ?? null;
}
```

### 5.4 Model Icon Component

```tsx
// src/components/icons/SettingsModelIcon.tsx
import { ModelIcon } from '@lobehub/icons';
import { Bot } from 'lucide-react';

// Map our model IDs to LobeHub model IDs
const MODEL_ID_MAP: Record<string, string> = {
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'gpt-5.5': 'gpt-5.5',
  'glm-5.1': 'glm-5.1',
};

export function SettingsModelIcon({ model, size = 20 }: { model: string; size?: number }) {
  const lobeModelId = MODEL_ID_MAP[model];
  if (lobeModelId) {
    return <ModelIcon model={lobeModelId} size={size} />;
  }
  return <Bot size={size} />; // fallback
}
```

---

## 6. Tool Call Icon Migration

Replace the emoji-based tool icons with proper SVG icons:

```tsx
// BEFORE (current)
const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '✏️',
  Bash: '⚡', Grep: '🔍', Glob: '📂',
  WebFetch: '🌐', WebSearch: '🌐',
  Task: '🤖', TodoWrite: '✅',
};

// AFTER (proposed)
import { FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare } from 'lucide-react';

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Bash: Terminal,
  Grep: Search,
  Glob: FolderOpen,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  TodoWrite: CheckSquare,
};
```

---

## 7. Icon Size Standards

Establish consistent icon sizes across the app:

| Context | Size | Usage |
|---------|------|-------|
| Navigation rail | 17px | Sidebar and right rail buttons |
| Inline with text | 15-16px | Setting rows, status badges |
| Card headers | 18-20px | Summary cards, agent cards |
| Large display | 24-34px | Account avatar area |
| Window controls | 11-14px | Top bar minimize/maximize/close |
| Tool call status | 14-16px | Inline tool call indicators |

---

## 8. What LobeHub Icons Cannot Replace

1. **TokenDance brand icon**: No TokenDance-specific icon exists. Use a custom SVG or adapt the LobeHub CDN pattern.
2. **Custom tool icons**: AgentHub-specific tools need custom icons.
3. **Platform icons**: macOS, Windows, Android platform icons should come from lucide-react or a platform icon set.
4. **File type icons**: Use lucide-react's FileText, FileCode, FileJson, etc.

---

## 9. Summary of Changes

### Immediate (this PR)
1. Install `@lobehub/icons`
2. Add `ModelIcon` to model dropdown select options
3. Add `ProviderIcon` to provider select options
4. Replace emoji tool icons with lucide-react SVG icons in ChatView.tsx

### This Week
5. Add `ProviderIcon` to agent list items
6. Add `ProviderIcon` to agent cards in settings
7. Create `AgentProviderIcon` wrapper component
8. Create `SettingsModelIcon` wrapper component
9. Standardize icon sizes across the app

### Later
10. Add model icons to thread messages (show which model generated each response)
11. Add CDN-based brand icons for external services
12. Create TokenDance custom brand icon
