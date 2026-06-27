# LibreChat Adoption Map: Message Tree, Fork & SiblingSwitch

> Analysis date: 2026-05-24
> Reference: `D:\Code\AgentHub\reference\LibreChat\`
> Target: `D:\Code\AgentHub\edge-server\internal\` + `D:\Code\AgentHub\app\desktop\src\components\`
> Status: Gap analysis against AgentHub's current implementation

---

## 1. buildTree Algorithm Comparison

### 1.1 LibreChat Implementation

**Source**: `reference\LibreChat\client\src\utils\buildTree.ts:8-19`

LibreChat's `buildTree` at the `data-provider` level (not in the file above, but referenced in existing analysis at `02-message-tree.md`) does:
- O(n) single-pass using a `messageMap: Record<string, ParentMessage>` hashmap
- Computes `depth` as `parent.depth + 1`
- Computes `siblingIndex` via a `childrenCount[parentId]` counter
- Handles orphans by promoting them to root nodes

The file at `buildTree.ts:8-19` is actually just `groupIntoList` for alternating row colors, not the main tree builder. The real `buildTree` is in `packages/data-provider/src/messages.ts` (documented in `02-message-tree.md`).

### 1.2 AgentHub Implementation

**Source**: `app\shared\src\tree.ts:1-69`

```typescript
export function buildTree<T extends { id: string; parentId?: string }>(
  items: T[],
): TreeNode<T>[] {
  const nodeMap = new Map<string, TreeNode<T>>();
  const roots: TreeNode<T>[] = [];
  for (const item of items) {
    const node: TreeNode<T> = { item, children: [], depth: 0 };
    nodeMap.set(item.id, node);
    if (!item.parentId) { roots.push(node); continue; }
    const parent = nodeMap.get(item.parentId);
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
```

### 1.3 Algorithm Differences

| Dimension | LibreChat | AgentHub | Gap |
|-----------|-----------|----------|-----|
| **Single-pass** | Yes | Yes | None |
| **Depth computation** | `parent.depth + 1` | `parent.depth + 1` | Identical |
| **SiblingIndex** | `childrenCount[parentId] - 1` counter | **Missing** | AgentHub doesn't track sibling index |
| **Orphan handling** | Promote to root | Promote to root | Identical |
| **Cycle guard** | `visited` Set | **Missing** | AgentHub has no cycle detection |
| **FileMap integration** | Resolves file references inline | N/A | AgentHub doesn't need this |
| **Generic typing** | Specific to TMessage | Generic `<T extends { id; parentId? }>` | AgentHub is more reusable |
| **Go backend** | N/A (frontend only) | **Missing** | AgentHub has no Go tree builder |

### 1.4 Specific Code Gap: SiblingIndex Support

**LibreChat** `packages/data-provider/src/messages.ts` (cited in `02-message-tree.md:93-96`):
```typescript
childrenCount[parentId] = (childrenCount[parentId] || 0) + 1;
const extendedMessage: ParentMessage = {
  ...message,
  children: [],
  depth: 0,
  siblingIndex: childrenCount[parentId] - 1,
};
```

**AgentHub** `app\shared\src\tree.ts:18-49` — no `siblingIndex` field anywhere.

**Proposed change to `app\shared\src\tree.ts`**:
```typescript
export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
  depth: number;
  siblingIndex: number;  // ADD: 0-based position among siblings
}

export function buildTree<T extends { id: string; parentId?: string }>(
  items: T[],
): TreeNode<T>[] {
  const nodeMap = new Map<string, TreeNode<T>>();
  const roots: TreeNode<T>[] = [];
  const childCount = new Map<string, number>();
  for (const item of items) {
    const parentId = item.parentId || '';
    childCount.set(parentId, (childCount.get(parentId) || 0) + 1);
    const node: TreeNode<T> = {
      item, children: [], depth: 0,
      siblingIndex: childCount.get(parentId)! - 1,  // ADD
    };
    // ... rest unchanged
  }
  return roots;
}
```

---

## 2. SiblingSwitch Component Comparison

### 2.1 LibreChat Implementation

**Source**: `reference\LibreChat\client\src\components\Chat\Messages\SiblingSwitch.tsx:1-68`

LibreChat's SiblingSwitch:
- Receives `siblingIdx`, `siblingCount`, `setSiblingIdx` as props
- Renders arrows + "N/M" label
- Returns `null` when `siblingCount <= 1` or props are undefined
- OnClick calls `setSiblingIdx(siblingIdx +/- 1)`
- Uses Lucide icons (ChevronLeft, ChevronRight)

**Critical**: `siblingIdx` is stored in **Recoil atomFamily per message ID** (`store\families.ts:347-350`):
```typescript
const messagesSiblingIdxFamily = atomFamily<number, string | null | undefined>({
  key: 'messagesSiblingIdx',
  default: 0,
});
```

And auto-resets on tree change (`MultiMessage.tsx`):
```typescript
useEffect(() => {
  setSiblingIdx(0);  // Reset to newest sibling when tree changes
}, [messagesTree?.length, setSiblingIdx]);
```

### 2.2 AgentHub Implementation

**Source**: `app\desktop\src\components\SiblingSwitch.tsx:1-46`

AgentHub's SiblingSwitch:
- Receives `siblingIdx`, `siblingCount`, `onPrev`, `onNext` as props
- Renders arrows + "N/M" label
- Returns `null` when `siblingCount <= 1`
- Stateless — siblingIdx is managed externally

### 2.3 Gap Analysis

| Dimension | LibreChat | AgentHub | Gap |
|-----------|-----------|----------|-----|
| **State storage** | Recoil atomFamily per messageId | External (parent component / store) | AgentHub needs per-node sibling state |
| **Auto-reset** | Resets to 0 on tree length change | No auto-reset | Gap |
| **Overflow guard** | Checks `siblingIdx >= messagesTree.length` | Relies on caller to guard | Gap |
| **Visual design** | Chevron left/right + numbers + hover styles | Arrow characters "←"/"→" + simple CSS | Minor styling gap |
| **Accessibility** | `aria-live="polite"`, `aria-atomic="true"`, `role="status"` | `aria-live="polite"`, `role="navigation"` | LibreChat has slightly better a11y |

### 2.4 Specific Gap: Per-Node Sibling State in MessageTree

**LibreChat** `reference\LibreChat\client\src\store\families.ts:347-350` — atomFamily per messageId.

**AgentHub** `app\desktop\src\components\MessageTree.tsx:76-97` — the tree renderer is stateless. `SiblingSwitch` is rendered elsewhere (in parent component), not inside `TreeNodeRow`.

**Proposed change**: The `MessageTree` component needs a Zustand store slice for per-node sibling positions:
```typescript
// In threadStore.ts or a new treeStore.ts
interface SiblingPositions {
  positions: Record<string, number>;  // messageId -> siblingIdx
  setSibling: (messageId: string, idx: number) => void;
  resetSibling: (messageId: string) => void;
}
```

---

## 3. Fork Mechanism Comparison

### 3.1 LibreChat Implementation

**Source**: `reference\LibreChat\client\src\components\Chat\Messages\Fork.tsx:202-446`

LibreChat Fork supports 4 modes (defined in `packages/data-provider/src/config.ts`):
- `DIRECT_PATH` — copy direct parent chain only
- `INCLUDE_BRANCHES` — copy tree with all sibling branches
- `TARGET_LEVEL` — copy up to target message depth (default)
- `DEFAULT` — copy from target message only

UI: Popover with 3 icon buttons + 2 checkboxes (Split at target, Remember choice)
State: `forkSetting`, `splitAtTarget`, `rememberGlobal` — all Recoil atoms

Backend fork logic in `api/server/utils/import/fork.js`:
- `forkConversation()` handles all 4 modes
- `splitAtTargetLevel()` preprocesses the tree before fork
- Creates new conversation with cloned messages (new messageIds, recalibrated timestamps)

### 3.2 AgentHub Implementation

**No Fork implementation exists.** AgentHub has:
- `ThreadPanel.tsx` — creates/renames/deletes threads but no fork
- `store.go:211-236` — `CreateThread` but no fork support
- `adapter.go:17-43` — no fork capability in AgentAdapter interface

### 3.3 What AgentHub Needs

**Frontend**: ForkDialog component with mode selection (minimum: DIRECT_PATH + include branches)
**Backend (Go)**: `ForkThread` API endpoint + store method
**Adapter**: `AgentCapabilities.Fork` flag

---

## 4. MessageTree Rendering Comparison

### 4.1 LibreChat

**Source**: `reference\LibreChat\client\src\components\Chat\Messages\Message.tsx` and `MultiMessage.tsx`

LibreChat renders messages recursively:
```
ChatView -> MessagesView -> MultiMessage -> Message -> (recursive) MultiMessage -> ...
```

Each message node:
1. Renders the message bubble (MessageRender)
2. Shows SiblingSwitch if siblings > 1
3. Recursively renders children via a nested MultiMessage

**Key trick** (`MultiMessage.tsx:49-60`): MultiMessage intentionally does NOT use React keys because messageId changes during SSE streaming (client UUID -> server ID), and using keys would cause unmount/remount and flicker.

### 4.2 AgentHub

**Source**: `app\desktop\src\components\MessageTree.tsx:76-97`

AgentHub renders messages with **visual tree connectors** (indent lines):
```
TreeNodeRow -> {treeRow {treeIndent (connectors) + treeContent}} + children recursion
```

This is more advanced than LibreChat for visualizing tree structure, but:
- Does not handle streaming key stability
- Does not integrate SiblingSwitch within tree nodes
- Falls back to flat rendering when no messages have parentId

### 4.3 Key Gap

**LibreChat** renders flat message list by default (chosen sibling path). Tree structure is visible only via SiblingSwitch navigation.

**AgentHub** renders the full tree with visual connectors but doesn't support sibling branch switching within the tree renderer itself.

**Proposal**: Merge both approaches — render linear active path with tree connectors at branch points, SiblingSwitch at nodes with siblings.

---

## 5. Go-Level Message Tree Interface Design

### 5.1 Current State

**Source**: `edge-server\internal\store\store.go:1-436`

AgentHub's Item struct has NO `parentId` field:
```go
type Item struct {
    ID        string `json:"itemId"`
    ProjectID string `json:"projectId"`
    ThreadID  string `json:"threadId"`
    RunID     string `json:"runId,omitempty"`
    Type      string `json:"type"`
    Role      string `json:"role,omitempty"`
    Status    string `json:"status"`
    Content   string `json:"content,omitempty"`
    CreatedAt string `json:"createdAt"`
    UpdatedAt string `json:"updatedAt"`
}
```

### 5.2 Required Changes

**1. Add parentItemId to Item struct**:

```go
type Item struct {
    // ... existing fields ...
    ParentItemID string `json:"parentItemId,omitempty"` // ADD
}
```

**2. Add BuildTree function in a new `pkg/tree` package or `store` package**:

```go
type MessageNode struct {
    MessageID       string          `json:"messageId"`
    ParentMessageID string          `json:"parentMessageId,omitempty"`
    ThreadID        string          `json:"threadId"`
    RunID           string          `json:"runId,omitempty"`
    Role            string          `json:"role"`
    Status          string          `json:"status"`
    Content         string          `json:"content,omitempty"`
    Depth           int             `json:"depth"`
    SiblingIndex    int             `json:"siblingIndex"`
    Children        []*MessageNode  `json:"children"`
}

func BuildTree(items []Item) []*MessageNode {
    nodeMap := make(map[string]*MessageNode)
    var roots []*MessageNode
    childCount := make(map[string]int)

    for _, item := range items {
        parentID := item.ParentItemID
        childCount[parentID]++

        node := &MessageNode{
            MessageID:    item.ID,
            ThreadID:     item.ThreadID,
            RunID:        item.RunID,
            Role:         item.Role,
            Status:       item.Status,
            Content:      item.Content,
            Depth:        0,
            SiblingIndex: childCount[parentID] - 1,
        }
        nodeMap[item.ID] = node

        if parent, ok := nodeMap[parentID]; ok {
            node.Depth = parent.Depth + 1
            parent.Children = append(parent.Children, node)
        } else {
            roots = append(roots, node)
        }
    }
    return roots
}
```

**3. Add ForkThread to store**:

```go
func (s *Store) ForkThread(
    sourceThreadID string,
    forkPointMessageID string,
    forkMode ForkMode,
) (Thread, error) {
    // 1. Copy source thread structure (projectID, title with "Fork: " prefix)
    // 2. Filter items based on forkMode
    // 3. Clone items with new IDs, preserving parentItemID relationships
    // 4. Create new thread entry
}
```

---

## 6. Concrete Adoption Cheatsheet

| # | Feature | LibreChat Source | AgentHub Current | Action |
|---|---------|-----------------|------------------|--------|
| 1 | O(n) buildTree | `packages/data-provider/src/messages.ts` | `app/shared/src/tree.ts:18-49` | Add siblingIndex, cycle guard |
| 2 | SiblingSwitch | `client/src/.../SiblingSwitch.tsx:1-68` | `app/desktop/.../SiblingSwitch.tsx:1-46` | Add per-node state via Zustand |
| 3 | Fork component | `client/src/.../Fork.tsx:202-446` | **Missing** | Build ForkDialog with 2 modes |
| 4 | Fork API | `api/server/utils/import/fork.js` | **Missing** | Build POST /threads/:id/fork |
| 5 | Go BuildTree | N/A | **Missing** | Add to `pkg/tree/builder.go` |
| 6 | parentItemId on Item | `packages/data-provider/src/schemas.ts:635+` -> `parentMessageId` | `store/store.go:40-51` (Item struct) | Add `ParentItemID string` |
| 7 | Recoil atomFamily for siblingIdx | `store/families.ts:347-350` | **Missing** | Use Zustand `positions: Record<string, number>` |
| 8 | Stream-safe keys | `MultiMessage.tsx:49-60` (no keys) | `MessageTree.tsx:59` (uses `child.item.id` as key) | Evaluate key stability during streaming |
| 9 | Message tree visual | N/A (flat rendering) | `MessageTree.tsx:37-50` (connector lines) | Already better than LibreChat |
| 10 | MultiMessage recursion | `client/src/.../MultiMessage.tsx` | `MessageTree.tsx:56-65` (TreeNodeRow recursion) | Already equivalent |
