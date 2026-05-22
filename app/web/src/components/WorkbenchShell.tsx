import {
  Activity,
  Bot,
  ClipboardCheck,
  FileCode2,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Play,
  RotateCcw,
  Search,
  TerminalSquare,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { HealthResponse, Runner } from '@shared/types';
import type { WorkbenchState } from '@/state/workbenchState';
import styles from './WorkbenchShell.module.css';

interface Props {
  online: boolean;
  connected: boolean;
  error: string | null;
  health: HealthResponse | null;
  runners: Runner[];
  state: WorkbenchState;
  onStartRun: () => void;
  onClearEvents: () => void;
}

type InspectionTab = 'files' | 'diff' | 'preview' | 'logs';

const tabs: Array<{ id: InspectionTab; label: string }> = [
  { id: 'files', label: 'Files' },
  { id: 'diff', label: 'Diff' },
  { id: 'preview', label: 'Preview' },
  { id: 'logs', label: 'Logs' },
];

export default function WorkbenchShell({
  online,
  connected,
  error,
  health,
  runners,
  state,
  onStartRun,
  onClearEvents,
}: Props) {
  const [activeTab, setActiveTab] = useState<InspectionTab>('diff');
  const runs = useMemo(() => Object.values(state.runsById), [state.runsById]);
  const latestRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
  const latestOutput = latestRun ? state.outputByRunId[latestRun.runId] : undefined;

  return (
    <div className={styles.root}>
      <nav className={styles.sidebar} aria-label="项目和线程">
        <header className={styles.sidebarHeader}>
          <div>
            <span className={styles.eyebrow}>AgentHub</span>
            <h1>Web 工作台</h1>
          </div>
          <button type="button" className={styles.iconButton} aria-label="搜索">
            <Search size={16} />
          </button>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <LayoutDashboard size={14} />
            Project
          </div>
          <button type="button" className={`${styles.listItem} ${styles.listItemSelected}`}>
            <GitBranch size={15} />
            <span>Local Edge</span>
            <small>{health?.edgeId ?? 'local'}</small>
          </button>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <Bot size={14} />
            Runners
          </div>
          {runners.length === 0 ? (
            <div className={styles.empty}>{online ? '暂无 Runner' : 'Edge 离线'}</div>
          ) : (
            runners.map((runner) => (
              <div className={styles.runnerRow} key={runner.id}>
                <span>{runner.name || runner.id}</span>
                <small>{runner.status}</small>
              </div>
            ))
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <Activity size={14} />
            Threads
          </div>
          <button type="button" className={styles.listItem}>
            <MessageSquare size={15} />
            <span>Mock run stream</span>
            <small>{latestRun?.status ?? 'idle'}</small>
          </button>
        </section>

        <footer className={styles.sidebarFooter}>
          <StatusDot active={online} />
          <span>Edge {online ? 'online' : 'offline'}</span>
          <span className={styles.footerDivider} />
          <StatusDot active={connected} />
          <span>WS {connected ? 'connected' : 'closed'}</span>
        </footer>
      </nav>

      <main className={styles.main} aria-label="线程工作区">
        <header className={styles.mainHeader}>
          <div>
            <span className={styles.eyebrow}>Thread</span>
            <h2>IM 运行流</h2>
          </div>
          <div className={styles.headerActions}>
            <button type="button" onClick={onClearEvents} className={styles.secondaryButton}>
              <RotateCcw size={15} />
              Clear
            </button>
            <button type="button" onClick={onStartRun} disabled={!online} className={styles.primaryButton}>
              <Play size={15} />
              Start mock run
            </button>
          </div>
        </header>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <section className={styles.messageStream} aria-label="事件消息流">
          <article className={`${styles.messageCard} ${styles.systemCard}`}>
            <strong>Web shell ready</strong>
            <p>
              当前切片对齐客户端 M1：Local Edge health、Runner 列表、Mock Run 命令和 WebSocket typed events。
            </p>
          </article>
          {state.events.length === 0 ? (
            <div className={styles.emptyState}>
              启动 Local Edge 后点击 Start mock run，事件会以 IM Item 形态进入中间流。
            </div>
          ) : (
            state.events.slice(-12).map((event) => (
              <article className={styles.messageCard} key={event.id}>
                <div className={styles.messageMeta}>
                  <span className={styles.eventType}>{event.type}</span>
                  <span>seq {event.seq}</span>
                </div>
                <p>{summarizePayload(event.payload)}</p>
              </article>
            ))
          )}
        </section>
      </main>

      <aside className={styles.inspector} aria-label="产物和检查面板">
        <div className={styles.tabList} role="tablist" aria-label="检查面板">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={styles.tab}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className={styles.inspectorBody}>
          {activeTab === 'diff' ? (
            <BoundaryPanel
              icon={<FileCode2 size={18} />}
              title="Diff boundary"
              body="M4 接入 Project / Worktree / Diff API 后，这里承载 changed files、diff hunks、Apply / Discard。"
            />
          ) : null}
          {activeTab === 'files' ? (
            <BoundaryPanel
              icon={<GitBranch size={18} />}
              title="Workspace files"
              body="文件树等待 Project / Workspace API 落地后接入；当前仅固定面板边界。"
            />
          ) : null}
          {activeTab === 'preview' ? (
            <BoundaryPanel
              icon={<ClipboardCheck size={18} />}
              title="Preview and approval"
              body="Preview、Approval 卡片后续从 artifact 和 approval 事件接入。"
            />
          ) : null}
          {activeTab === 'logs' ? (
            <div>
              <div className={styles.panelTitle}>
                <TerminalSquare size={18} />
                Run output
              </div>
              {!latestOutput ? (
                <p className={styles.muted}>暂无 stdout/stderr 输出。</p>
              ) : (
                <pre className={styles.logBox}>
                  {[...latestOutput.stdout, ...latestOutput.stderr]
                    .sort((a, b) => a.offset - b.offset)
                    .map((chunk) => chunk.text)
                    .join('')}
                </pre>
              )}
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return <span aria-hidden="true" className={`${styles.statusDot} ${active ? styles.statusDotActive : ''}`} />;
}

function BoundaryPanel({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div>
      <div className={styles.panelTitle}>
        {icon}
        {title}
      </div>
      <p className={styles.muted}>{body}</p>
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.runId === 'string') parts.push(`run=${payload.runId}`);
  if (typeof payload.runnerId === 'string') parts.push(`runner=${payload.runnerId}`);
  if (typeof payload.status === 'string') parts.push(`status=${payload.status}`);
  if (typeof payload.stream === 'string') parts.push(`stream=${payload.stream}`);
  if (typeof payload.text === 'string') parts.push(payload.text.slice(0, 80));
  if (Array.isArray(payload.chunks)) parts.push(`chunks=${payload.chunks.length}`);
  return parts.join(' ') || 'event received';
}
