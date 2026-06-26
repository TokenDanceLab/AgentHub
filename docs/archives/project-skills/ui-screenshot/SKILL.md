---
name: ui-screenshot
description: AgentHub Desktop UI 自动化截图、竞品对比分析与迭代改进。当需要验证 UI 改动效果、对比竞品界面、或进行视觉回归测试时调用。
---

# UI Screenshot — AgentHub Desktop 视觉自动化

## When to Use

- 修改 CSS/布局后需要验证实际渲染效果
- 用户提到"不好看"但没有具体描述，需要截图诊断
- 对标竞品（Codex App / Claude Desktop / Cursor）进行界面分析
- 深色/浅色模式切换后的视觉回归检查
- 验证响应式布局在不同窗口尺寸下的表现

## When NOT to Use

- 纯逻辑/数据流改动不需要截图
- 用户已经提供了截图并明确指出了具体问题
- 单文件 typo 修复

## 前置依赖

```bash
# Desktop 目录下已安装 playwright
cd app/desktop
pnpm exec playwright install chromium
```

## 工作流

### 1. 启动 Desktop Dev Server

Playwright 访问 Vite dev server（而非 Tauri 二进制），避免构建开销：

```bash
cd app/desktop
# Terminal 1: 启动 dev server
pnpm dev

# Terminal 2: 启动 Edge Server（提供 mock 数据）
cd ../../edge-server
go run ./cmd/agenthub-edge --mock
```

### 2. 截图

使用 `scripts/capture.ts`：

```bash
cd app/desktop
npx tsx .agents/skills/ui-screenshot/scripts/capture.ts \
  --url http://localhost:5173 \
  --out screenshots/$(date +%Y%m%d-%H%M%S).png \
  --theme dark          # dark | light
  --viewport 1440,900   # width,height
  --wait 2000           # ms, 等字体/动画稳定
```

**常用区域裁剪**（添加 `--region x,y,w,h`）：
| 区域 | 坐标 (1440x900) |
|---|---|
| 消息气泡区 | `--region 300,120,840,600` |
| 输入框 | `--region 300,740,840,120` |
| 侧边栏 | `--region 0,34,280,866` |
| 右侧面板 | `--region 1160,120,280,600` |
| 顶部栏 | `--region 0,0,1440,34` |

### 3. 竞品对比分析

截图后，自己调用图像分析：

1. **读截图** — `Read` 工具查看生成的 PNG
2. **与竞品对比** — 参考已保存的竞品截图（`screenshots/reference/`）
3. **分析差异** — 用以下维度做结构化对比：
   - 色彩/对比度（深色模式死黑？浅色模式刺眼？）
   - 留白/间距（消息太挤？边距失衡？）
   - 字体层级（标题太大？正文太小？）
   - 圆角/形状（气泡太圆？按钮太平？）
   - 交互反馈（hover 态？焦点态？）
4. **生成改进清单** — 最多 3 个最高优先级项

### 4. 自动迭代

根据分析结果直接修改代码，然后重新截图验证，循环直到满意。

**迭代原则：**
- 每次只改 1-2 个文件，别大范围重构
- CSS 改动后截图验证，再改下一个
- 如果改完更糟，直接 `git checkout` 回退
- 最多 3 轮迭代，超时报给用户

## 截图脚本 (scripts/capture.ts)

见同目录 `scripts/capture.ts`。核心逻辑：

1. 用 Playwright 启动 Chromium
2. 设置 viewport + `prefers-color-scheme`
3. 注入 mock 数据（agents/threads/messages）避免白屏
4. 等待网络/字体/动画稳定
5. 截图保存

## Mock 数据注入

截图脚本会自动注入 `window.__MOCK_DATA__`，包含：
- 3 个 agent（Claude Code / Codex / OpenCode）
- 2 个 thread
- 示例消息流（user + agent）
- 运行中状态（用于测试右侧面板）

如需自定义场景，修改 `scripts/capture.ts` 中的 `MOCK_PAYLOAD`。

## 竞品参考图管理

竞品截图保存在 `screenshots/reference/`：

```
screenshots/reference/
├── codex-app-dark.png      # Codex App 深色模式
├── codex-app-light.png     # Codex App 浅色模式
├── claude-desktop-dark.png # Claude Desktop 深色
└── README.md               # 每张图的标注说明
```

新增竞品截图：手动截取后放这里，在 `README.md` 标注关键 UI 特征。

## 深色模式检查清单

截图后自查：

- [ ] 背景不是纯黑（#000），应有灰度层次
- [ ] 卡片/面板有微弱边框或阴影区分层次
- [ ] 用户消息气泡不是死白，而是融入背景的淡色
- [ ] 文字对比度足够但不刺眼
- [ ] hover 态有可见反馈
- [ ] 边框线不是纯黑，而是极淡白/灰

## 常见问题

**Q: Tauri 窗口截图和 Playwright 截图有差异？**
A: Playwright 截图的是 Web 渲染层（Chromium），Tauri 实际用的是系统 WebView（Edge WebView2 on Windows）。差异通常很小（字体渲染、滚动条样式）。关键布局差异需要真机验证。

**Q: 截图里中文显示为方块？**
A: Playwright Chromium 可能缺少中文字体。截图脚本已配置 `--font-render-hinting=none` 并等待字体加载。如仍有问题，在本地系统安装 `Noto Sans CJK`。

**Q: 如何截图特定状态（如右侧面板展开）？**
A: 修改 `capture.ts` 中的 `MOCK_PAYLOAD.currentRun` 为非 null 值，脚本会自动触发右侧面板展开。

## 参考

- `app/desktop/playwright.config.ts` — Desktop E2E 配置
- `app/desktop/e2e/test-utils.ts` — 现有 E2E 工具函数
- `screenshots/reference/README.md` — 竞品截图标注
