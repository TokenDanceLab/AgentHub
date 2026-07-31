// pinMap — session-scoped messageId → pinned store (TODO(pinMap) 落地).
//
// Hub 消息本身不带 pin 状态（model.Message 无 pinned 字段；pin 存在独立的
// message_pins 表）。本 store 由两条链路维护，消费已有协议、不新增 WS/REST：
// - WS frames MESSAGE_PIN / MESSAGE_UNPIN（hubEvents.ts）经 handleFrame 喂入
// - REST GET /client/sessions/{id}/pins（hubClient.listPinnedMessages）在
//   会话切换时经 loadPinnedForSession 整表播种
// normalize 调用方（web/desktop workbench model）用 getSnapshot() 或
// isPinned() 把状态合并进 HubMessageTranscriptInput.pinned，再由
// normalizeHubMessagesToTranscript 写进 block.pinned（该字段已接线，
// 菜单切换也已接线）。
//
// 设计：纯 TS 工厂 + 全局单例（与 transcript/agentActivity.ts 同模式，
// 不引 zustand）。内部按 sessionId 分桶保留全量 pin 集（切回会话无需
// 重新播种）；"当前会话"指针决定 setPinned/isPinned 读写哪个桶。

import type { HubMessageTranscriptInput } from './normalizeHubMessages';
import { HUB_EVENTS } from '../hubEvents';

// ── Public types ──────────────────────────────────────────────────────────

export interface PinMapSnapshot {
  /** 当前活跃会话 id（未播种 / 登出时为 null）。 */
  sessionId: string | null;
  /** 当前活跃会话下 pinned 的 messageId 集合（快照副本，不可变）。 */
  pinnedIds: ReadonlySet<string>;
}

export interface PinMapStore {
  /**
   * 切换当前会话指针。会话切换 / 登出时由调用方触发
   * （loadPinnedForSession 内部也会切，通常无需单独调用）。
   */
  setActiveSession(sessionId: string | null): void;
  /**
   * WS frame 喂入：写入当前会话桶的 messageId → pinned。
   * 无活跃会话时 no-op（登出或尚未播种期间的 frame 直接丢弃）。
   */
  setPinned(messageId: string, pinned: boolean): void;
  /** normalize 合并查询：当前会话下该消息是否 pinned。 */
  isPinned(messageId: string): boolean;
  /**
   * 端点播种：整表替换 sessionId 桶的 pin 集合并把当前会话切到
   * sessionId。messageIds 即 GET /client/sessions/{id}/pins 返回的
   * 消息 id（HubMessage.id）——该列表是服务端全量 pin 集，所以是
   * 替换而非合并。
   */
  loadPinnedForSession(sessionId: string, messageIds: readonly string[]): void;
  /**
   * 统一 frame 入口：MESSAGE_PIN / MESSAGE_UNPIN → setPinned，
   * 其他类型 no-op。payload 缺 session_id / message_id 时忽略。
   * 传入 activeSessionId 时只接受与该会话匹配的 frame
   * （web 端传 runtimeSessionIdRef.current；desktop 端 bridge 无会话
   * 上下文，不传——接受迟到帧污染的小风险，见 loadPinnedForSession
   * 的整表替换兜底）。
   */
  handleFrame(eventType: string, payload: unknown, activeSessionId?: string | null): void;
  /** React useSyncExternalStore 兼容订阅（getSnapshot 返回稳定引用）。 */
  subscribe(listener: () => void): () => void;
  getSnapshot(): PinMapSnapshot;
  /** 清空全部会话数据并重置指针（登出 / 测试）。 */
  reset(): void;
}

// ── Store factory ─────────────────────────────────────────────────────────

export function createPinMapStore(): PinMapStore {
  // sessionId → pinned messageIds（全量保留，切回会话无需重新播种）
  const bySession = new Map<string, Set<string>>();
  let activeSessionId: string | null = null;
  const listeners = new Set<() => void>();
  let cachedSnapshot: PinMapSnapshot | null = null;

  function notify(): void {
    cachedSnapshot = null;
    for (const listener of listeners) listener();
  }

  function setActiveSession(sessionId: string | null): void {
    if (activeSessionId === sessionId) return;
    activeSessionId = sessionId;
    notify();
  }

  function setPinned(messageId: string, pinned: boolean): void {
    const pinnedIds = activeSessionId ? bySession.get(activeSessionId) : undefined;
    // 无活跃会话（登出 / 尚未播种）：丢弃 frame，避免污染未来会话。
    if (!pinnedIds) return;
    const wasPinned = pinnedIds.has(messageId);
    if (pinned && !wasPinned) {
      pinnedIds.add(messageId);
      notify();
    } else if (!pinned && wasPinned) {
      pinnedIds.delete(messageId);
      notify();
    }
  }

  function loadPinnedForSession(sessionId: string, messageIds: readonly string[]): void {
    const next = new Set<string>();
    for (const id of messageIds) {
      if (typeof id === 'string' && id) next.add(id);
    }
    const previous = bySession.get(sessionId);
    const sessionChanged = activeSessionId !== sessionId
      || previous === undefined
      || previous.size !== next.size
      || !everyId(previous, next);
    bySession.set(sessionId, next);
    activeSessionId = sessionId;
    if (sessionChanged) notify();
  }

  function handleFrame(
    eventType: string,
    payload: unknown,
    activeSessionIdFilter?: string | null,
  ): void {
    if (eventType !== HUB_EVENTS.MESSAGE_PIN && eventType !== HUB_EVENTS.MESSAGE_UNPIN) return;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const record = payload as Record<string, unknown>;
    const sessionId = readStr(record, 'session_id', 'sessionId');
    const messageId = readStr(record, 'message_id', 'messageId', 'id');
    if (!sessionId || !messageId) return;
    // 活跃会话过滤：只接受当前会话的 frame（web 端防跨会话污染）。
    if (activeSessionIdFilter != null && sessionId !== activeSessionIdFilter) return;
    setPinned(messageId, eventType === HUB_EVENTS.MESSAGE_PIN);
  }

  function getSnapshot(): PinMapSnapshot {
    if (cachedSnapshot == null) {
      cachedSnapshot = {
        sessionId: activeSessionId,
        pinnedIds: new Set(activeSessionId ? (bySession.get(activeSessionId) ?? []) : []),
      };
    }
    return cachedSnapshot;
  }

  function reset(): void {
    bySession.clear();
    activeSessionId = null;
    notify();
  }

  return {
    setActiveSession,
    setPinned,
    isPinned: (messageId) => Boolean(activeSessionId && bySession.get(activeSessionId)?.has(messageId)),
    loadPinnedForSession,
    handleFrame,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot,
    reset,
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _instance: PinMapStore | undefined;

/**
 * 全局单例 pinMap store。懒创建，模块导入无副作用
 * （与 getAgentActivityStore 同模式）。
 */
export function getPinMapStore(): PinMapStore {
  if (!_instance) _instance = createPinMapStore();
  return _instance;
}

// ── Pure merge helper ─────────────────────────────────────────────────────

/**
 * 把 pinMap 的 pinned 状态合并进 normalize 输入（normalize 调用方使用）。
 *
 * - 匹配 key：`message.id ?? message.message_id`——与 WS frame 的
 *   message_id 同源（server message id）。client_msg_id 是客户端生成的
 *   另一套 id，不参与匹配。
 * - 仅 pinned===true 时附加 `pinned: true`：false / 缺席保持字段 unset
 *   （normalizeHubMessages 只把 true 写进 block.pinned，exactOptional
 *   风格）。
 * - 无变化时返回原数组引用（memo 友好）。
 */
export function withPinnedState(
  messages: HubMessageTranscriptInput[] | undefined,
  pinnedIds: ReadonlySet<string>,
): HubMessageTranscriptInput[] | undefined {
  if (!messages?.length || pinnedIds.size === 0) return messages;
  let changed = false;
  const next = messages.map((message) => {
    const id = message.id ?? message.message_id;
    if (!id || !pinnedIds.has(id) || message.pinned === true) return message;
    changed = true;
    return { ...message, pinned: true };
  });
  return changed ? next : messages;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function readStr(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function everyId(previous: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  for (const id of previous) {
    if (!next.has(id)) return false;
  }
  return true;
}
