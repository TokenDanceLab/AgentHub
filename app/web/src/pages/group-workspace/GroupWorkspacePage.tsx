import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, Pill, ProgressBar } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './GroupWorkspacePage.module.css';

/* ---- inline mock data (static prototype) ---- */

type MockRunner = { id: string; name: string; status: string; capabilities?: string };
type MockRun = { runId: string; threadId: string; projectId: string; status: string; createdAt: string };
type MockFile = { path: string; sizeBytes: number; modifiedAt: string };

const mockRunners: MockRunner[] = [
  { id: 'runner-001', name: 'Xavier Chen', status: 'online', capabilities: 'Code review, Frontend, TypeScript' },
  { id: 'runner-002', name: 'Security-Core', status: 'online', capabilities: 'Security audit, Vulnerability scan' },
  { id: 'runner-003', name: 'DB Migrator', status: 'offline', capabilities: 'Database migration, Schema design' },
  { id: 'runner-004', name: 'Kubernetes Ops', status: 'busy', capabilities: 'K8s, Helm, Docker' },
];

const mockRuns: MockRun[] = [
  { runId: 'run_parser_v2', threadId: 'thread-01', projectId: 'proj-legacy', status: 'running', createdAt: '2026-05-24T08:00:00Z' },
  { runId: 'run_snapshot_sync', threadId: 'thread-02', projectId: 'proj-legacy', status: 'queued', createdAt: '2026-05-24T08:30:00Z' },
  { runId: 'run_security_audit', threadId: 'thread-03', projectId: 'proj-legacy', status: 'finished', createdAt: '2026-05-24T07:00:00Z' },
];

const mockWorkspaceFiles: MockFile[] = [
  { path: 'src/pages/AgentSquare.tsx', sizeBytes: 14 * 1024, modifiedAt: '2026-05-23' },
  { path: 'src/pages/PrivateChats.tsx', sizeBytes: 18 * 1024, modifiedAt: '2026-05-24' },
  { path: 'docs/api-spec.md', sizeBytes: 3 * 1024, modifiedAt: '2026-05-22' },
  { path: 'deploy/helm-values.yaml', sizeBytes: 2 * 1024 * 1024, modifiedAt: '2026-05-20' },
];

/* ---- Mock Event Stream (static prototype) ---- */
type StreamEvent = { type: string; payload: Record<string, unknown> };

class MockEventStream {
  private listeners: Array<(event: StreamEvent) => void> = [];
  private destroyed = false;
  on(listener: (event: StreamEvent) => void) {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }
  emit(event: StreamEvent) {
    if (this.destroyed) return;
    this.listeners.forEach((l) => l(event));
  }
  destroy() { this.destroyed = true; this.listeners = []; }
}

function playRunLifecycle(stream: MockEventStream, _opts?: { stepDelayMs?: number }) {
  const events: StreamEvent[] = [
    { type: 'run.queued', payload: { runId: 'run_parser_v2', status: 'queued' } },
    { type: 'run.started', payload: { runId: 'run_parser_v2', status: 'running' } },
    { type: 'run.output', payload: { runId: 'run_parser_v2', stream: 'stdout', offset: 0, text: 'Analyzing parser logic...' } },
    { type: 'run.output', payload: { runId: 'run_parser_v2', stream: 'stdout', offset: 1, text: 'Dependencies resolved.' } },
    { type: 'run.agent.tool_call', payload: { runId: 'run_parser_v2', tool: 'read_file', status: 'completed' } },
    { type: 'run.finished', payload: { runId: 'run_parser_v2', status: 'finished' } },
  ];
  let i = 0;
  const interval = setInterval(() => {
    if (i < events.length) { stream.emit(events[i]!); i++; } else { clearInterval(interval); }
  }, 1200);
  return () => clearInterval(interval);
}

/* ---- Types ---- */

type TaskStatus = 'backlog' | 'active' | 'review';
type ApprovalState = 'pending' | 'approved' | 'changes';
type MemberPresence = 'online' | 'busy' | 'offline';
type MemberFilter = 'all' | MemberPresence;
type ConfirmationTone = 'info' | 'success' | 'warning';

type Member = {
  initials: string;
  name: string;
  role: string;
  accent: 'blue' | 'cyan' | 'purple' | 'teal';
  presence: MemberPresence;
};

type WorkspaceTask = {
  id: string;
  title: string;
  summary: string;
  owner: string;
  status: TaskStatus;
  tag: string;
  progress: number;
};

type FileItem = {
  name: string;
  detail: string;
  size: string;
  accent: 'blue' | 'cyan' | 'purple' | 'teal';
};

type ActivityItem = {
  title: string;
  detail: string;
  time: string;
  accent: 'blue' | 'cyan' | 'purple' | 'teal';
};

type SyncState = {
  complete: boolean;
  fileCount: number;
  lastSyncedAt: string;
  progress: number;
  revision: number;
};

type Confirmation = {
  detail: string;
  title: string;
  tone: ConfirmationTone;
};

const members: Member[] = mockRunners.map((runner, i) => ({
  initials: runner.name.split(' ').map((w) => w[0]!).join('').toUpperCase().slice(0, 2),
  name: runner.name,
  role: runner.capabilities ?? 'No capability info',
  accent: (['blue', 'purple', 'teal', 'cyan'] as const)[i % 4]!,
  presence: (runner.status === 'online' ? 'online' : 'offline') as MemberPresence,
}));

const baseTasks: WorkspaceTask[] = mockRuns.map((run, i) => ({
  id: run.runId,
  title: `Run ${run.runId.split('_').pop()} — ${run.status}`,
  summary: `Thread: ${run.threadId}, Project: ${run.projectId}`,
  owner: mockRunners[i % mockRunners.length]?.name ?? 'Unassigned',
  status: (run.status === 'finished' ? 'review' : run.status === 'running' ? 'active' : 'backlog') as TaskStatus,
  tag: run.status === 'running' ? 'Active' : run.status === 'finished' ? 'Done' : 'Queue',
  progress: run.status === 'finished' ? 100 : run.status === 'running' ? 65 : 15,
}));

const initialFiles: FileItem[] = mockWorkspaceFiles.map((f, i) => ({
  name: f.path,
  detail: `${(f.sizeBytes / 1024).toFixed(1)} KB, modified ${f.modifiedAt.slice(0, 10)}`,
  size: f.sizeBytes > 1024 * 1024 ? `${(f.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : `${(f.sizeBytes / 1024).toFixed(1)} KB`,
  accent: (['cyan', 'purple', 'teal', 'blue'] as const)[i % 4]!,
}));

const initialActivities: ActivityItem[] = mockRuns.map((run, i) => ({
  title: `${mockRunners[i % mockRunners.length]?.name ?? 'Agent'} — run.${run.status}`,
  detail: `Run on thread ${run.threadId}: ${run.status === 'finished' ? 'Completed successfully' : run.status === 'running' ? 'Executing...' : 'Waiting in queue'}`,
  time: run.createdAt.slice(11, 16),
  accent: (['cyan', 'purple', 'teal'] as const)[i % 3]!,
}));

const laneLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  active: 'In progress',
  review: 'Review',
};

const memberFilterOptions: Array<{ id: MemberFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'busy', label: 'Busy' },
  { id: 'offline', label: 'Offline' },
];

const presenceLabels: Record<MemberPresence, string> = {
  online: 'Online',
  busy: 'Busy',
  offline: 'Offline',
};

const accentIconMap: Record<string, string> = {
  blue: '',
  cyan: styles.accentCyan as string,
  purple: styles.accentPurple as string,
  teal: styles.accentTeal as string,
};

const avatarClassMap: Record<string, string> = {
  purple: styles.avatarPurpleGrad as string,
  teal: styles.avatarTealGrad as string,
  cyan: styles.avatarCyanGrad as string,
};

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function GroupWorkspacePage() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [approval, setApproval] = useState<ApprovalState>('pending');
  const [taskOwner, setTaskOwner] = useState('Xavier');
  const [syncState, setSyncState] = useState<SyncState>({
    complete: false,
    fileCount: 12,
    lastSyncedAt: 'Not synced',
    progress: 82,
    revision: 0,
  });
  const [activityLog, setActivityLog] = useState<ActivityItem[]>(initialActivities);
  const [workspaceMembers, setWorkspaceMembers] = useState<Member[]>(members);
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('all');
  const [noteDraft, setNoteDraft] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>({
    detail: 'Local controls are wired for review, sync, assignment, member presence, and notes.',
    title: 'Interactive workspace ready',
    tone: 'info',
  });

  /* ---- Particle canvas (inline because WebLayout needs it as sibling) ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particleCount = 56;
    let particles: Array<{ x: number; y: number; r: number; vx: number; vy: number; hue: number; alpha: number }> = [];
    let width = 0;
    let height = 0;
    let frame = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const seed = () => {
      particles = Array.from({ length: particleCount }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1.6 + Math.random() * 2.6,
        vx: -0.18 + Math.random() * 0.36,
        vy: -0.18 - Math.random() * 0.48,
        hue: i % 3 === 0 ? 196 : 210,
        alpha: 0.18 + Math.random() * 0.2,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -16) { p.y = height + 16; p.x = Math.random() * width; }
        if (p.x < -16) p.x = width + 16;
        if (p.x > width + 16) p.x = -16;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 84%, 48%, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        particles.slice(i + 1).forEach((n) => {
          const dx = p.x - n.x;
          const dy = p.y - n.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 126) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(23, 105, 232, ${(1 - d / 126) * 0.07})`;
            ctx.lineWidth = 1;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(n.x, n.y);
            ctx.stroke();
          }
        });
      });
      frame = window.requestAnimationFrame(draw);
    };

    const handleResize = () => { resize(); seed(); };
    resize();
    seed();
    frame = window.requestAnimationFrame(draw);
    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  /* ---- Mock event stream ---- */
  const pushActivity = (a: Omit<ActivityItem, 'time'>) => {
    setActivityLog((cur) => [{ ...a, time: nowLabel() }, ...cur].slice(0, 8));
  };

  useEffect(() => {
    const stream = new MockEventStream();
    const unsub = stream.on((event) => {
      pushActivity({
        title: event.type,
        detail: typeof event.payload === 'object' && event.payload && 'text' in event.payload
          ? String((event.payload as Record<string, unknown>).text).trim().slice(0, 100) || '(output)'
          : JSON.stringify(event.payload).slice(0, 100),
        accent: (['cyan', 'purple', 'teal', 'blue'] as const)[Math.floor(Math.random() * 4)]!,
      });
    });
    playRunLifecycle(stream, { stepDelayMs: 1000 });
    return () => { stream.destroy(); unsub(); };
  }, []);

  /* ---- Derived state ---- */
  const approved = approval === 'approved';
  const needsEdits = approval === 'changes';
  const visibleMembers = workspaceMembers.filter((m) => memberFilter === 'all' || m.presence === memberFilter);
  const onlineCount = workspaceMembers.filter((m) => m.presence === 'online').length;
  const busyCount = workspaceMembers.filter((m) => m.presence === 'busy').length;
  const approvalLabel = approved ? t('gw.approval.approved') : needsEdits ? t('gw.approval.changes') : t('gw.approval.pending');
  const approvalLocked = !approved;

  const syncedFiles: FileItem[] = syncState.revision
    ? [{ name: `sync_receipt_r${syncState.revision}.txt`, detail: `Created by dry-run sync at ${syncState.lastSyncedAt}`, size: '2 KB', accent: 'blue' as const }]
    : [];
  const workspaceFiles = [...initialFiles, ...syncedFiles];

  const tasks = useMemo<WorkspaceTask[]>(() => {
    return baseTasks.map((task) => {
      if (task.id === 'approve') {
        return {
          ...task,
          owner: taskOwner,
          progress: approval === 'approved' ? 100 : approval === 'changes' ? 60 : 82,
          summary: approval === 'approved' ? 'Approved for dry-run sync. Snapshot action is unlocked.' : approval === 'changes' ? 'Reviewer requested one visible edit before approval.' : task.summary,
        };
      }
      if (task.id === 'snapshot' && syncState.complete) {
        return { ...task, progress: syncState.progress, summary: `Dry-run snapshot synced at ${syncState.lastSyncedAt}.` };
      }
      return task;
    });
  }, [approval, syncState.complete, syncState.lastSyncedAt, syncState.progress, taskOwner]);

  const laneTasks = (status: TaskStatus) => tasks.filter((t) => t.status === status);

  /* ---- Actions ---- */
  const showConfirmation = (c: Confirmation) => setConfirmation(c);

  const approveParser = () => {
    setApproval('approved');
    setSyncState((cur) => ({ ...cur, complete: false, progress: Math.max(cur.progress, 91) }));
    pushActivity({ title: 'Xavier approved parser v2', detail: 'Sync controls are unlocked and the review task is marked complete.', accent: 'blue' });
    showConfirmation({ title: 'Approval saved', detail: 'Parser v2 is approved. The snapshot sync button is now enabled.', tone: 'success' });
  };

  const requestEdits = () => {
    setApproval('changes');
    setSyncState((cur) => ({ ...cur, complete: false, progress: 74 }));
    pushActivity({ title: 'Xavier requested parser edits', detail: 'Sync was locked again until the requested changes are resolved.', accent: 'purple' });
    showConfirmation({ title: 'Changes requested', detail: 'Approval state changed and sync is locked while the review is open.', tone: 'warning' });
  };

  const assignSecurity = () => {
    const nextOwner = taskOwner === 'Security-Core' ? 'Xavier' : 'Security-Core';
    setTaskOwner(nextOwner);
    pushActivity({ title: `Approval assigned to ${nextOwner}`, detail: 'Task owner changed on the review card, board, and sync checklist.', accent: 'teal' });
    showConfirmation({ title: 'Review reassigned', detail: `Parser v2 is now assigned to ${nextOwner}.`, tone: 'info' });
  };

  const syncSnapshot = () => {
    if (!approved) {
      showConfirmation({ title: 'Sync is locked', detail: 'Approve parser v2 before syncing the shared snapshot.', tone: 'warning' });
      return;
    }
    const syncedAt = nowLabel();
    const nextRev = syncState.revision + 1;
    setSyncState((cur) => ({ complete: true, fileCount: cur.fileCount + 1, lastSyncedAt: syncedAt, progress: 100, revision: nextRev }));
    pushActivity({ title: 'Dry-run snapshot synced', detail: `Workspace files updated and sync receipt generated at ${syncedAt}.`, accent: 'cyan' });
    showConfirmation({ title: 'Snapshot synced', detail: `Files, progress, and last sync time now reflect revision ${nextRev}.`, tone: 'success' });
  };

  const cycleMemberPresence = (memberName: string) => {
    const m = workspaceMembers.find((m2) => m2.name === memberName);
    if (!m) return;
    const next: MemberPresence = m.presence === 'online' ? 'busy' : m.presence === 'busy' ? 'offline' : 'online';
    setWorkspaceMembers((cur) => cur.map((m2) => m2.name === memberName ? { ...m2, presence: next } : m2));
    pushActivity({ title: `${m.name} is now ${presenceLabels[next].toLowerCase()}`, detail: 'Member presence changed locally and the member filter counters updated.', accent: m.accent });
    showConfirmation({ title: 'Member status updated', detail: `${m.name} switched to ${presenceLabels[next]}.`, tone: next === 'offline' ? 'warning' : 'info' });
  };

  const selectMemberFilter = (filter: MemberFilter) => {
    setMemberFilter(filter);
    showConfirmation({ title: 'Member filter changed', detail: filter === 'all' ? 'Showing every workspace member.' : `Showing only members marked ${presenceLabels[filter].toLowerCase()}.`, tone: 'info' });
  };

  const sendNote = () => {
    const trimmed = noteDraft.trim();
    if (!trimmed) { showConfirmation({ title: 'Note is empty', detail: 'Write a collaboration note before sending it to the activity flow.', tone: 'warning' }); return; }
    pushActivity({ title: 'Collaboration note sent', detail: trimmed, accent: 'blue' });
    setNoteDraft('');
    showConfirmation({ title: 'Note posted', detail: 'The note was added to the activity flow and the composer was cleared.', tone: 'success' });
  };

  const fillComposer = (token: string, confirmationTitle: string) => {
    setNoteDraft((cur) => `${cur}${cur ? ' ' : ''}${token}`);
    showConfirmation({ title: confirmationTitle, detail: 'Composer content was updated locally.', tone: 'info' });
  };

  const createLocalFile = () => {
    setSyncState((cur) => ({ ...cur, fileCount: cur.fileCount + 1 }));
    pushActivity({ title: 'Local file placeholder added', detail: 'Shared file count increased without contacting a backend.', accent: 'cyan' });
    showConfirmation({ title: 'File placeholder added', detail: 'The file counter changed locally for this interactive preview.', tone: 'info' });
  };

  const exportSummary = () => {
    pushActivity({ title: 'Workspace summary prepared', detail: 'Export is represented as a local confirmation for this preview.', accent: 'teal' });
    showConfirmation({ title: 'Export prepared', detail: 'No file was downloaded. The action is captured in the activity flow.', tone: 'success' });
  };

  /* ---- Build member filter labels (use translation keys, fallback to hardcoded) ---- */
  const filterLabels: Record<MemberFilter, string> = {
    all: t('gw.members.filter.all'),
    online: t('gw.members.filter.online'),
    busy: t('gw.members.filter.busy'),
    offline: t('gw.members.filter.offline'),
  };

  /* ---- Sidebar bottom: spaces + members + health ---- */
  const sidebarBottom = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
      {/* Spaces nav */}
      <div>
        <div className={styles.sectionHead}>
          <h3 className={styles.sidebarSectionTitle}>{t('gw.spaces')}</h3>
          <Pill variant="cyan">{t('gw.spaces.live')}</Pill>
        </div>
        <div className={styles.stack}>
          <div className={`${styles.sidebarNav} ${styles.sidebarNavActive}`}>
            <div className={styles.accentIcon}>S</div>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 13 }}>{t('gw.spaces.legacy')}</strong>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('gw.spaces.legacyDesc')}</p>
            </div>
          </div>
          <div className={styles.sidebarNav}>
            <div className={`${styles.accentIcon} ${styles.accentPurple}`}>R</div>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 13 }}>{t('gw.spaces.mapping')}</strong>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('gw.spaces.mappingDesc')}</p>
            </div>
          </div>
          <div className={styles.sidebarNav}>
            <div className={`${styles.accentIcon} ${styles.accentCyan}`}>F</div>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 13 }}>{t('gw.spaces.files')}</strong>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('gw.spaces.filesDesc', { count: syncState.fileCount })}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Members */}
      <div>
        <div className={styles.sectionHead}>
          <h3 className={styles.sidebarSectionTitle}>{t('gw.members')}</h3>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{t('gw.members.onlineCount', { online: onlineCount, busy: busyCount })}</span>
        </div>
        <div className={styles.filterRow} role="group" aria-label="Filter members by status">
          {memberFilterOptions.map((opt) => (
            <button
              className={`${styles.filterBtn} ${opt.id === memberFilter ? styles.filterBtnActive : ''}`}
              key={opt.id}
              type="button"
              onClick={() => selectMemberFilter(opt.id)}
            >
              {filterLabels[opt.id]}
            </button>
          ))}
        </div>
        <div className={styles.stack}>
          {visibleMembers.map((m) => (
            <button
              className={styles.memberItem}
              key={m.name}
              type="button"
              onClick={() => cycleMemberPresence(m.name)}
            >
              <span className={`${styles.memberAvatar} ${avatarClassMap[m.accent] ?? ''} ${m.presence === 'busy' ? styles.avatarBusy : m.presence === 'offline' ? styles.avatarOffline : ''}`}>
                {m.initials}
              </span>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{m.name}</strong>
                <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.role} - {t(`gw.presence.${m.presence}`)}
                </p>
              </div>
            </button>
          ))}
          {visibleMembers.length === 0 ? (
            <div className={styles.emptyHint}>{t('gw.members.noMatch')}</div>
          ) : null}
        </div>
      </div>

      {/* Workspace Health */}
      <div className={styles.healthCard}>
        <div className={styles.sectionHead}>
          <span className={`${styles.topEyebrow}`}>{t('gw.health.label')}</span>
          <Pill variant={syncState.complete ? 'green' : 'cyan'}>{syncState.complete ? t('gw.health.synced') : t('gw.health.stable')}</Pill>
        </div>
        <p className={styles.healthText}>{t('gw.health.localOnly', { time: syncState.lastSyncedAt })}</p>
      </div>
    </div>
  );

  /* ---- Drawer: approval + sync + files ---- */
  const drawer = (
    <>
      {/* Approval */}
      <div className={styles.sidebarSection}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.topEyebrow}>{t('gw.approval.eyebrow')}</p>
            <h3 className={styles.sidebarSectionTitle}>{t('gw.approval.title')}</h3>
          </div>
          <Pill variant={approved ? 'green' : needsEdits ? 'purple' : 'default'}>{approvalLabel}</Pill>
        </div>
        <div className={styles.approvalCard}>
          <div className={styles.row}>
            <strong style={{ fontSize: 13 }}>{approvalLabel}</strong>
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Owner: {taskOwner}</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
            {approved ? t('gw.approval.approvedDesc') : needsEdits ? t('gw.approval.changesDesc') : t('gw.approval.pendingDesc')}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" size="sm" onClick={requestEdits}>{t('gw.approval.requestEdits')}</Button>
            <Button variant="primary" size="sm" onClick={approveParser}>{t('gw.approval.approve')}</Button>
          </div>
        </div>
      </div>

      {/* Sync */}
      <div className={styles.sidebarSection}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.topEyebrow}>{t('gw.sync.eyebrow')}</p>
            <h3 className={styles.sidebarSectionTitle}>{t('gw.sync.title')}</h3>
          </div>
          <Pill variant={syncState.complete ? 'green' : 'cyan'}>{syncState.progress}%</Pill>
        </div>
        <div className={styles.syncCard}>
          <div className={styles.row}>
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{t('gw.sync.readiness')}</span>
            <strong style={{ fontSize: 12 }}>{syncState.complete ? t('gw.sync.complete') : approved ? t('gw.sync.unlocked') : t('gw.sync.locked')}</strong>
          </div>
          <ProgressBar value={syncState.progress} />
          <Button variant="primary" size="md" disabled={approvalLocked} onClick={syncSnapshot}>
            {syncState.complete ? t('gw.sync.again') : approved ? t('gw.sync.action') : t('gw.sync.approveFirst')}
          </Button>
          <div>
            <div className={styles.checkRow}>
              <span className={`${styles.dot} ${styles.dotCyan}`} />
              <div>
                <strong style={{ fontSize: 13 }}>{t('gw.sync.filesIndexed')}</strong>
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>{t('gw.sync.filesAvailable', { count: syncState.fileCount })}</p>
              </div>
            </div>
            <div className={styles.checkRow}>
              <span className={`${styles.dot} ${styles.dotPurple}`} />
              <div>
                <strong style={{ fontSize: 13 }}>{t('gw.sync.assignments')}</strong>
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>{t('gw.sync.assignmentsDetail', { owner: taskOwner })}</p>
              </div>
            </div>
            <div className={styles.checkRow}>
              <span className={styles.dot} />
              <div>
                <strong style={{ fontSize: 13 }}>{t('gw.sync.lastSync')}</strong>
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>{t('gw.sync.lastSyncValue', { time: syncState.lastSyncedAt })}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Files */}
      <div className={styles.sidebarSection}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.topEyebrow}>{t('gw.files.eyebrow')}</p>
            <h3 className={styles.sidebarSectionTitle}>{t('gw.files.title')}</h3>
          </div>
          <Button variant="icon" onClick={createLocalFile} aria-label="Add file">
            <Icon name="add" />
          </Button>
        </div>
        <div className={styles.stack}>
          {workspaceFiles.map((file) => (
            <div className={styles.fileRow} key={file.name}>
              <div className={`${styles.accentIcon} ${accentIconMap[file.accent] ?? ''}`}>{file.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: 13 }}>{file.name}</strong>
                <p className={styles.fileRowDesc}>{file.detail}</p>
              </div>
              <span className={styles.fileSize}>{file.size}</span>
            </div>
          ))}
          {workspaceFiles.length === 0 ? <div className={styles.emptyHint}>{t('gw.files.empty')}</div> : null}
        </div>
      </div>
    </>
  );

  return (
    <div className={styles.pageRoot}>
      <ParticleCanvas />
      <WebLayout
        brandName={t('gw.brand')}
        brandSubtitle={t('gw.subtitle')}
        sectionLabels={[
          { text: t('gw.spaces') },
          { text: t('gw.members') },
        ]}
        sidebarBottom={sidebarBottom}
        topbarLeft={
          <div className={styles.topTitle}>
            <p className={styles.topEyebrow}>{t('gw.topbar.eyebrow')}</p>
            <h1 className={styles.topHeading}>{t('gw.topbar.title')}</h1>
            <p className={styles.topDesc}>{t('gw.topbar.subtitle')}</p>
          </div>
        }
        topbarRight={
          <div className={styles.topActions}>
            <div className={styles.searchMock}>
              <Icon name="search" size={16} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('gw.topbar.searchHint')}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={exportSummary}>{t('gw.topbar.export')}</Button>
            <Button variant="primary" size="sm" onClick={assignSecurity}>{t('gw.topbar.assignReview')}</Button>
          </div>
        }
        drawer={drawer}
      >
        {/* Main content */}
        <div className={styles.mainContent}>
          {/* Stats */}
          <div className={styles.stats}>
            <div className={styles.statCard}><span className={styles.statValue}>{onlineCount}</span><span className={styles.statLabel}>{t('gw.stats.online')}</span></div>
            <div className={styles.statCard}><span className={styles.statValue}>{tasks.length}</span><span className={styles.statLabel}>{t('gw.stats.tasks')}</span></div>
            <div className={styles.statCard}><span className={styles.statValue}>{syncState.fileCount}</span><span className={styles.statLabel}>{t('gw.stats.files')}</span></div>
            <div className={styles.statCard}><span className={styles.statValue}>{syncState.progress}%</span><span className={styles.statLabel}>{t('gw.stats.sync')}</span></div>
          </div>

          {/* Confirmation bar */}
          <div className={`${styles.confirmBar} ${confirmation.tone === 'success' ? styles.confirmSuccess : confirmation.tone === 'warning' ? styles.confirmWarning : ''}`} aria-live="polite">
            <div>
              <div className={styles.confirmTitle}>{confirmation.title}</div>
              <div className={styles.confirmDetail}>{confirmation.detail}</div>
            </div>
            <Button variant="icon" onClick={() => showConfirmation({ title: 'Status bar cleared', detail: 'The next local action will appear here.', tone: 'info' })} aria-label="Dismiss confirmation">
              <Icon name="close" />
            </Button>
          </div>

          {/* Content grid: board + feed */}
          <div className={styles.contentGrid}>
            {/* Board column */}
            <div className={styles.glassPanel}>
              <div className={styles.sectionHead}>
                <div>
                  <p className={styles.topEyebrow}>{t('gw.board.eyebrow')}</p>
                  <h2 className={styles.sidebarSectionTitle} style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('gw.board.title')}</h2>
                </div>
                <Pill variant="purple">{t('gw.board.autoAssigned')}</Pill>
              </div>
              <div className={styles.board}>
                {(Object.keys(laneLabels) as TaskStatus[]).map((status) => (
                  <section className={styles.lane} key={status}>
                    <div className={styles.row}>
                      <h3 className={styles.laneTitle}>{t(`gw.board.${status === 'backlog' ? 'backlog' : status === 'active' ? 'inProgress' : 'review'}`)}</h3>
                      <Pill variant="default">{laneTasks(status).length}</Pill>
                    </div>
                    {laneTasks(status).map((task) => (
                      <article className={styles.taskCard} key={task.id}>
                        <div className={styles.row}>
                          <Pill variant={task.status === 'review' ? 'purple' : 'cyan'}>{task.tag}</Pill>
                          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{task.progress}%</span>
                        </div>
                        <h3>{task.title}</h3>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>{task.summary}</p>
                        <div className={styles.progress} aria-label={`${task.title} progress`}>
                          <span className={styles.progressFill} style={{ width: `${task.progress}%` }} />
                        </div>
                        <div className={styles.row}>
                          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{t('gw.board.owner')}: {task.owner}</span>
                          {task.id === 'approve' ? (
                            <Button variant="secondary" size="sm" onClick={assignSecurity}>{t('gw.board.reassign')}</Button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            </div>

            {/* Feed column */}
            <div className={`${styles.glassPanel}`}>
              <div className={styles.sectionHead}>
                <div>
                  <p className={styles.feedEyebrow}>{t('gw.feed.eyebrow')}</p>
                  <h2 className={styles.feedTitle}>{t('gw.feed.title')}</h2>
                </div>
                <Pill variant={syncState.complete ? 'green' : 'cyan'}>
                  <span className={styles.dot} style={{ marginTop: 0 }} />
                  {' '}{syncState.complete ? t('gw.feed.synced') : t('gw.feed.live')}
                </Pill>
              </div>
              <div className={styles.activityList}>
                {activityLog.map((activity, index) => (
                  <div className={styles.activityRow} key={`${activity.title}-${index}`}>
                    <div className={`${styles.accentIcon} ${accentIconMap[activity.accent] ?? ''}`}>{activity.accent.slice(0, 1).toUpperCase()}</div>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13 }}>{activity.title}</strong>
                      <p className={styles.activityRowDesc}>{activity.detail}</p>
                      <span className={styles.activityTime}>{activity.time}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.composer}>
                <div className={styles.row}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button variant="icon" onClick={() => fillComposer('@group', 'Mention inserted')} aria-label="Mention member">
                      <Icon name="alternate_email" />
                    </Button>
                    <Button variant="icon" onClick={() => fillComposer('[attachment]', 'Attachment marker inserted')} aria-label="Attach file">
                      <Icon name="attach_file" />
                    </Button>
                    <Button variant="icon" onClick={() => fillComposer('#task', 'Task marker inserted')} aria-label="Create task">
                      <Icon name="checklist" />
                    </Button>
                  </div>
                  <Pill variant="cyan">@group</Pill>
                </div>
                <textarea
                  aria-label="Workspace message"
                  placeholder={t('gw.composer.placeholder')}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
                <div className={styles.row}>
                  <span className={styles.composerHint}>{noteDraft.trim() ? t('gw.composer.ready', { count: noteDraft.trim().length }) : t('gw.composer.empty')}</span>
                  <Button variant="primary" size="sm" disabled={!noteDraft.trim()} onClick={sendNote}>{t('gw.composer.send')}</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </WebLayout>
    </div>
  );
}

export default GroupWorkspacePage;
