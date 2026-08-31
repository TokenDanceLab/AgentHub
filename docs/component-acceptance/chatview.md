# Chatview 组件范本表（chatview）

> 来源：component-acceptance.md 拆分（#2092）。验收维度与三件套规则见主文件 `../component-acceptance.md`。

### MediaAttachment（`app/shared/src/chatview/components/MediaAttachment.tsx`，#1939 三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化（`--chat-*` 密度阶梯 + `--td-*`） | ✅ | RowItem.css `att-media-*` 块消费 `--chat-sp-*`/`--chat-r-md`/`--td-line`，无硬编码调色板；播放器本体为原生控件 |
| 视觉 | light/dark 对比度 + 状态区分 | ✅ | 随 MediaAttachment.stories.tsx 巡检（AudioReady/VideoReady/Loading/Unavailable/TooLarge 5 态）；通知文案走 `--td-ink-subtle` 既有 `.att-image-status` |
| 交互 | 端口解析状态机（loading→ready/unavailable/too-large/failed）行为断言 | ✅ | MediaAttachment.test.tsx 覆盖五态转换；超限行不触发 fetch（fetched=false 断言） |
| 交互 | 异步期间无空播放器、完成后恢复可交互 | ✅ | loading 态显示明确通知，不渲染 `<audio>`/`<video>`；ready 态原生控件可交互 |
| 键盘 | 播放器为原生 `<audio controls>`/`<video controls>`，继承浏览器原生键盘操作 | ✅ | 无自定义浮层，无焦点陷阱需求 |
| a11y | 可访问名称 | ✅ | 播放器带 `aria-label`（`card.attachment.audioInline`/`videoInline`）；降级通知 `role="status"` |
| a11y | 诚实降级，无静默坏播放器 | ✅ | 无 resolver/解析失败/加载失败/超限/危险 scheme 均回退文件 chip + 明确状态通知；负向测试断言 `javascript:`/`data:` URL 不进 `src` |
| 响应式 | 播放器宽度夹取，无横向滚动 | ✅ | `max-width:320px`（音频 100%/视频 320x180 上限），随窄容器收缩 |

## 验收记录与 debt
