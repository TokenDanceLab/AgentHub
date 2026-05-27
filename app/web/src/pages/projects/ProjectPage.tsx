import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, Pill, SearchInput, ProgressBar } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './ProjectPage.module.css';

/* ---- inline mock data (static prototype) ---- */

type MockProject = { id: string; name: string; description: string };
type MockRun = { runId: string; threadId: string; projectId: string; status: string; createdAt: string };
type MockFile = { path: string; sizeBytes: number; modifiedAt: string };
type MockRunner = { id: string; name: string };

const mockProjects: MockProject[] = [
  { id: 'proj_ui_coord', name: 'UI Coordination', description: 'Frontend page preview, CSS modules migration, and reactive coordination across workbench and agent pages.' },
  { id: 'proj_api_contract', name: 'API Contract Review', description: 'Review endpoint contracts, event streams, and type safety for the agent hub unified API surface.' },
  { id: 'proj_infra', name: 'Infrastructure Migration', description: 'Deploy preview pipeline and edge server configuration for the next reactive page milestone.' },
];

const mockRuns: MockRun[] = [
  { runId: 'run_ui_pass', threadId: 'thread-01', projectId: 'proj_ui_coord', status: 'running', createdAt: '2026-05-24T08:00:00Z' },
  { runId: 'run_api_smoke', threadId: 'thread-02', projectId: 'proj_api_contract', status: 'finished', createdAt: '2026-05-24T07:30:00Z' },
  { runId: 'run_infra_test', threadId: 'thread-03', projectId: 'proj_infra', status: 'queued', createdAt: '2026-05-24T08:15:00Z' },
];

const mockWorkspaceFiles: MockFile[] = [
  { path: 'src/pages/AgentSquarePage.tsx', sizeBytes: 14 * 1024, modifiedAt: '2026-05-23' },
  { path: 'src/pages/PrivateChatsPage.tsx', sizeBytes: 18 * 1024, modifiedAt: '2026-05-24' },
  { path: 'docs/api-spec.md', sizeBytes: 3 * 1024, modifiedAt: '2026-05-22' },
  { path: 'deploy/helm-values.yaml', sizeBytes: 2 * 1024, modifiedAt: '2026-05-20' },
];

const mockRunners: MockRunner[] = [
  { id: 'runner-001', name: 'Frontend page coordinator' },
  { id: 'runner-002', name: 'API review agent' },
  { id: 'runner-003', name: 'Infra specialist' },
];

type BoardView = 'overview' | 'tasks' | 'files';
type TaskStatus = 'Done' | 'Active' | 'Next';
type FileType = 'TSX' | 'DOC';
type FileFilter = 'All' | FileType;
type RunStatus = 'Pass' | 'Ready' | 'Deferred' | 'Local';
type RunFilter = 'All' | RunStatus;
type NoticeTone = 'success' | 'info' | 'warning';

type Task = { id: string; title: string; owner: string; status: TaskStatus; detail: string };
type FileItem = { name: string; type: FileType; status: string; detail: string };
type RunRecord = { id: string; status: RunStatus; detail: string; time: string };
type RiskItem = { id: string; title: string; detail: string; status: 'Open' | 'Reviewed' | 'Tracked'; reviewable: boolean };
type TaskForm = { title: string; owner: string; detail: string };
type Notice = { tone: NoticeTone; message: string };

const emptyTaskForm: TaskForm = {
  title: 'Review project page responsive states',
  owner: 'Frontend page coordinator',
  detail: 'Check tabs, risk toggle, sync feedback, and drawer spacing.',
};

const fileFilters: FileFilter[] = ['All', 'TSX', 'DOC'];
const runFilters: RunFilter[] = ['All', 'Pass', 'Ready', 'Deferred', 'Local'];

const projects = mockProjects.map((p) => ({
  code: p.id.split('_').pop()?.toUpperCase().slice(0, 2) ?? p.id.slice(0, 2).toUpperCase(),
  name: p.name,
  detail: p.description ?? '',
  status: 'In progress' as const,
}));

const initialTasks: Task[] = mockRuns.map((run, i) => ({
  id: `task-${run.runId}`,
  title: `Run ${run.runId.split('_').pop()} on ${run.threadId}`,
  owner: mockRunners[i % mockRunners.length]?.name ?? 'Agent',
  status: (run.status === 'finished' ? 'Done' : run.status === 'running' ? 'Active' : 'Next') as TaskStatus,
  detail: `Status: ${run.status}. Project: ${run.projectId}, Thread: ${run.threadId}`,
}));

const initialFiles: FileItem[] = mockWorkspaceFiles.map((f) => ({
  name: f.path.split('/').pop() ?? f.path,
  type: (f.path.endsWith('.tsx') || f.path.endsWith('.ts') ? 'TSX' : 'DOC') as FileType,
  status: 'Edited',
  detail: `${f.path} — ${(f.sizeBytes / 1024).toFixed(1)} KB, modified ${f.modifiedAt.slice(0, 10)}`,
}));

const initialRuns: RunRecord[] = mockRuns.map((run) => ({
  id: run.runId,
  status: (run.status === 'finished' ? 'Pass' : run.status === 'running' ? 'Ready' : run.status === 'queued' ? 'Deferred' : 'Local') as RunStatus,
  detail: `Run on thread ${run.threadId}, project ${run.projectId}. Status: ${run.status}.`,
  time: run.createdAt.slice(11, 16),
}));

const initialRisks: RiskItem[] = [
  { id: 'risk-no-api', title: 'No live API yet', detail: 'All data is static and safe for page coordination.', status: 'Open', reviewable: true },
  { id: 'risk-parallel-edits', title: 'Parallel page edits', detail: 'This worker only changes ProjectPageInteractive.tsx.', status: 'Tracked', reviewable: false },
  { id: 'risk-local-only', title: 'Local-only state', detail: 'New tasks, risk review, filters, and sync runs reset after refresh.', status: 'Open', reviewable: true },
];

const milestones = [
  { title: 'Preview shell locked', detail: 'Route preview and project page layout are stable enough for review.', status: 'Done' },
  { title: 'Stateful React copy', detail: 'Tabs, task panel, risk review, and sync feedback are visible.', status: 'Active' },
  { title: 'Real API pass', detail: 'Deferred until contracts and backend mocks settle.', status: 'Later' },
];

function statusTone(status: string): 'blue' | 'cyan' | 'purple' | 'green' | 'amber' {
  if (status === 'Done' || status === 'Pass' || status === 'Reviewed') return 'green';
  if (status === 'Review' || status === 'Ready' || status === 'Local') return 'cyan';
  if (status === 'Queued' || status === 'Later' || status === 'Deferred') return 'purple';
  if (status === 'Next' || status === 'Open') return 'amber';
  return 'blue';
}

function matchesQuery(fields: string[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f.toLowerCase().includes(q));
}

function nextTaskStatus(s: TaskStatus): TaskStatus {
  if (s === 'Next') return 'Active';
  if (s === 'Active') return 'Done';
  return 'Active';
}

function formatLocalTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ProjectPage() {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<BoardView>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [projectTasks, setProjectTasks] = useState<Task[]>(initialTasks);
  const [projectRuns, setProjectRuns] = useState<RunRecord[]>(initialRuns);
  const [projectRisks, setProjectRisks] = useState<RiskItem[]>(initialRisks);
  const [fileFilter, setFileFilter] = useState<FileFilter>('All');
  const [runFilter, setRunFilter] = useState<RunFilter>('All');
  const [lastSyncAt, setLastSyncAt] = useState('Not synced yet');
  const [syncStatus, setSyncStatus] = useState('Idle');
  const [notice, setNotice] = useState<Notice | null>(null);

  const canSaveTask = taskForm.title.trim().length > 0 && taskForm.owner.trim().length > 0;
  const completedTaskCount = projectTasks.filter((t) => t.status === 'Done').length;
  const activeTaskCount = projectTasks.filter((t) => t.status !== 'Done').length;
  const deliveryProgress = Math.round((completedTaskCount / Math.max(projectTasks.length, 1)) * 100);
  const reviewableRisks = projectRisks.filter((r) => r.reviewable);
  const openRiskCount = projectRisks.filter((r) => r.status === 'Open').length;
  const reviewedRiskCount = projectRisks.filter((r) => r.status === 'Reviewed').length;
  const riskProgress = Math.round((reviewedRiskCount / Math.max(reviewableRisks.length, 1)) * 100);
  const allReviewableRisksClosed = reviewableRisks.every((r) => r.status === 'Reviewed');

  const filteredProjects = useMemo(() => projects.filter((p) => matchesQuery([p.name, p.detail, p.status], searchTerm)), [searchTerm]);
  const filteredTasks = useMemo(() => projectTasks.filter((t) => matchesQuery([t.title, t.owner, t.detail, t.status], searchTerm)), [projectTasks, searchTerm]);
  const filteredFiles = useMemo(() => initialFiles.filter((f) => (fileFilter === 'All' || f.type === fileFilter) && matchesQuery([f.name, f.type, f.status, f.detail], searchTerm)), [fileFilter, searchTerm]);
  const filteredRuns = useMemo(() => projectRuns.filter((r) => (runFilter === 'All' || r.status === runFilter) && matchesQuery([r.id, r.status, r.detail, r.time], searchTerm)), [projectRuns, runFilter, searchTerm]);

  const activityPrompt = useMemo(() => {
    if (notice) return notice.message;
    if (openRiskCount > 0) return `${openRiskCount} open risk${openRiskCount === 1 ? '' : 's'} still need review.`;
    return `${activeTaskCount} active task${activeTaskCount === 1 ? '' : 's'} remain after local review.`;
  }, [activeTaskCount, notice, openRiskCount]);

  const boardTitle = useMemo(() => {
    if (activeView === 'tasks') return t('pj.board.tasks', { count: filteredTasks.length });
    if (activeView === 'files') return t('pj.board.files', { count: filteredFiles.length });
    return t('pj.board.overview', { count: filteredProjects.length });
  }, [activeView, filteredFiles.length, filteredProjects.length, filteredTasks.length, t]);

  /* ---- Actions ---- */
  const openTaskPanel = () => { setIsTaskPanelOpen(true); setNotice(null); };
  const closeTaskPanel = () => setIsTaskPanelOpen(false);
  const updateTaskForm = (field: keyof TaskForm, value: string) => setTaskForm((cur) => ({ ...cur, [field]: value }));

  const saveTask = () => {
    if (!canSaveTask) { setNotice({ tone: 'warning', message: 'Add a task title and owner before saving.' }); return; }
    const newTask: Task = { id: `local-task-${Date.now().toString(36)}`, title: taskForm.title.trim(), owner: taskForm.owner.trim(), status: 'Next', detail: taskForm.detail.trim() || 'No additional note was added.' };
    setProjectTasks((cur) => [...cur, newTask]);
    setTaskForm(emptyTaskForm);
    setIsTaskPanelOpen(false);
    setActiveView('tasks');
    setNotice({ tone: 'success', message: `Saved "${newTask.title}" as a local task.` });
  };

  const toggleTaskStatus = (taskId: string) => {
    const ct = projectTasks.find((t) => t.id === taskId);
    if (!ct) return;
    const ns = nextTaskStatus(ct.status);
    setProjectTasks((cur) => cur.map((t) => t.id === taskId ? { ...t, status: ns } : t));
    setNotice({ tone: ns === 'Done' ? 'success' : 'info', message: `"${ct.title}" moved to ${ns}.` });
  };

  const toggleRisk = (riskId: string) => {
    const cr = projectRisks.find((r) => r.id === riskId);
    if (!cr || !cr.reviewable) return;
    const ns = cr.status === 'Reviewed' ? 'Open' : 'Reviewed' as const;
    setProjectRisks((cur) => cur.map((r) => r.id === riskId ? { ...r, status: ns } : r));
    setNotice({ tone: ns === 'Reviewed' ? 'success' : 'warning', message: ns === 'Reviewed' ? `"${cr.title}" marked reviewed.` : `"${cr.title}" reopened for review.` });
  };

  const toggleAllReviewableRisks = () => {
    const ns = allReviewableRisksClosed ? 'Open' : 'Reviewed' as const;
    setProjectRisks((cur) => cur.map((r) => r.reviewable ? { ...r, status: ns } : r));
    setNotice({ tone: ns === 'Reviewed' ? 'success' : 'warning', message: ns === 'Reviewed' ? 'All reviewable risks are marked reviewed.' : 'Reviewable risks were reopened.' });
  };

  const simulateSync = () => {
    const syncTime = formatLocalTime();
    const syncRun: RunRecord = { id: `local-sync-${String(projectRuns.length + 1).padStart(3, '0')}`, status: 'Local', detail: `Local sync captured ${activeTaskCount} active tasks and ${openRiskCount} open risks.`, time: syncTime };
    setLastSyncAt(syncTime);
    setSyncStatus('Local sync complete');
    setProjectRuns((cur) => [syncRun, ...cur]);
    setRunFilter('All');
    setNotice({ tone: 'info', message: `Sync updated local run records at ${syncTime}.` });
  };

  const taskActionLabel = (s: TaskStatus) => s === 'Next' ? t('pj.tasks.start') : s === 'Active' ? t('pj.tasks.markDone') : t('pj.tasks.reopen');

  /* ---- Nav items ---- */
  const navItems = [
    { icon: 'overview', label: t('pj.nav.overview'), active: activeView === 'overview', onClick: () => setActiveView('overview') },
    { icon: 'checklist', label: t('pj.nav.tasks'), active: activeView === 'tasks', onClick: () => setActiveView('tasks') },
    { icon: 'folder', label: t('pj.nav.files'), active: activeView === 'files', onClick: () => setActiveView('files') },
  ];

  const sidebarAction = (
    <Button variant="primary" size="md" onClick={openTaskPanel} style={{ width: '100%' }}>
      <Icon name="add" size={16} />{t('pj.nav.newTask')}
    </Button>
  );

  const sidebarBottom = (
    <div className={styles.sidebarSignal}>
      <strong className={styles.sidebarSignalTitle}>{t('pj.sidebar.signal')}</strong>
      <span className={styles.sidebarSignalText}>{activityPrompt}</span>
    </div>
  );

  /* ---- Drawer: task creation ---- */
  const drawer = isTaskPanelOpen ? (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
        <h3 className={styles.drawerTitle}>{t('pj.drawer.title')}</h3>
        <Button variant="icon" onClick={closeTaskPanel} aria-label="Close"><Icon name="close" /></Button>
      </div>
      <p className={styles.drawerHint}>{t('pj.drawer.description')}</p>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-title">{t('pj.drawer.fieldTitle')}</label>
        <input id="task-title" className={styles.fieldInput} value={taskForm.title} onChange={(e) => updateTaskForm('title', e.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-owner">{t('pj.drawer.fieldOwner')}</label>
        <input id="task-owner" className={styles.fieldInput} value={taskForm.owner} onChange={(e) => updateTaskForm('owner', e.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-note">{t('pj.drawer.fieldNote')}</label>
        <textarea id="task-note" className={styles.fieldTextarea} value={taskForm.detail} onChange={(e) => updateTaskForm('detail', e.target.value)} />
      </div>
      <div className={styles.drawerActions}>
        <Button variant="primary" disabled={!canSaveTask} onClick={saveTask}>{t('pj.drawer.save')}</Button>
        <Button variant="secondary" onClick={closeTaskPanel}>{t('pj.drawer.close')}</Button>
      </div>
      {!canSaveTask ? <span className={styles.drawerWarning}>{t('pj.drawer.required')}</span> : null}
    </>
  ) : undefined;

  return (
    <div className={styles.pageRoot}>
      <ParticleCanvas />
      <WebLayout
        brandName={t('pj.brand')}
        brandSubtitle={t('pj.subtitle')}
        navItems={navItems}
        sidebarAction={sidebarAction}
        sidebarBottom={sidebarBottom}
        topbarLeft={<SearchInput placeholder={t('pj.topbar.search')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />}
        topbarRight={
          <div className={styles.topbarActions}>
            <Button variant="icon" disabled={!searchTerm} onClick={() => setSearchTerm('')} aria-label="Clear search"><Icon name="close" /></Button>
            <Button variant="icon" aria-label="Notifications"><Icon name="notifications" /></Button>
            <Button variant="icon" aria-label="Settings"><Icon name="settings" /></Button>
            <div className={styles.avatarBtn} aria-label="Current user">PM</div>
          </div>
        }
        drawer={drawer}
      >
        <div className={styles.scrollArea}>
          {/* Hero */}
          <section className={styles.hero}>
            <div>
              <p className={styles.heroEyebrow}>{t('pj.hero.eyebrow')}</p>
              <h2 className={styles.heroTitle}>{t('pj.hero.title')}</h2>
              <p className={styles.heroDesc}>{t('pj.hero.description')}</p>
              <div className={styles.heroActions}>
                <Button variant="primary" onClick={simulateSync}>{syncStatus === 'Idle' ? t('pj.hero.sync') : t('pj.hero.syncAgain')}</Button>
                <Button variant="secondary" disabled={reviewableRisks.length === 0} onClick={toggleAllReviewableRisks}>
                  {allReviewableRisksClosed ? t('pj.hero.risksReopen') : t('pj.hero.risksReviewed')}
                </Button>
                <Button variant="ghost" onClick={openTaskPanel}>{t('pj.hero.newTask')}</Button>
                {notice ? <span className={`${styles.syncMessage} ${notice.tone === 'success' ? styles.syncSuccess : notice.tone === 'warning' ? styles.syncWarning : ''}`}>{notice.message}</span> : null}
              </div>
            </div>
            <div className={styles.heroSide}>
              <div className={styles.progressCard}>
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>{t('pj.progress.delivery')}</span>
                  <strong className={styles.progressValue}>{deliveryProgress}%</strong>
                </div>
                <ProgressBar value={deliveryProgress} label={`${deliveryProgress}%`} />
              </div>
              <div className={styles.progressCard}>
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>{t('pj.progress.openRisks')}</span>
                  <strong className={styles.progressValue}>{openRiskCount}</strong>
                </div>
                <ProgressBar value={riskProgress} />
              </div>
              <div className={styles.progressCard}>
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>{t('pj.progress.syncStatus')}</span>
                  <strong className={styles.progressValue}>{syncStatus === 'Idle' ? t('pj.progress.idle') : t('pj.progress.complete')}</strong>
                </div>
                <p className={styles.progressMuted}>{lastSyncAt === 'Not synced yet' ? t('pj.progress.notSynced') : lastSyncAt}</p>
              </div>
            </div>
          </section>

          {/* Metrics */}
          <section className={styles.metricsGrid} aria-label="Project metrics">
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>TK</span>
              <div>
                <span className={styles.metricValue}>{activeTaskCount}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.activeTasks')}</span>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>M1</span>
              <div>
                <span className={styles.metricValue}>{milestones.length}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.milestones')}</span>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>FL</span>
              <div>
                <span className={styles.metricValue}>{initialFiles.length}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.sharedFiles')}</span>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>RN</span>
              <div>
                <span className={styles.metricValue}>{projectRuns.length}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.dryRuns')}</span>
              </div>
            </article>
          </section>

          {/* Board grid */}
          <div className={styles.boardGrid}>
            {/* Main panel */}
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>{boardTitle}</h3>
                <div className={styles.tabBar} role="tablist" aria-label="Project board sections">
                  {(['overview', 'tasks', 'files'] as BoardView[]).map((view) => (
                    <button
                      key={view}
                      role="tab"
                      type="button"
                      aria-selected={activeView === view}
                      className={activeView === view ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setActiveView(view)}
                    >
                      {view === 'overview' ? t('pj.nav.overview') : view === 'tasks' ? t('pj.nav.tasks') : t('pj.nav.files')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Overview */}
              {activeView === 'overview' ? (
                <div className={styles.list}>
                  {filteredProjects.length > 0 ? (
                    filteredProjects.map((project) => (
                      <article className={styles.projectRow} key={project.name}>
                        <div className={styles.rowTitle}>
                          <span className={styles.iconTile}>{project.code}</span>
                          <div>
                            <span className={styles.rowName}>{project.name}</span>
                            <p className={styles.rowDetail}>{project.detail}</p>
                          </div>
                        </div>
                        <Pill variant={statusTone(project.status) === 'green' ? 'green' : statusTone(project.status) === 'cyan' ? 'cyan' : statusTone(project.status) === 'purple' ? 'purple' : statusTone(project.status) === 'amber' ? 'amber' : 'default'}>
                          {project.status}
                        </Pill>
                      </article>
                    ))
                  ) : (
                    <div className={styles.emptyState}>
                      <strong className={styles.emptyTitle}>{t('pj.empty.noProjects')}</strong>
                      <span className={styles.emptyText}>{t('pj.empty.clearSearch')}</span>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Tasks */}
              {activeView === 'tasks' ? (
                <div className={styles.list}>
                  <div className={styles.filterBar}>
                    <span className={styles.progressMuted}>{t('pj.tasks.doneCount', { done: completedTaskCount, total: projectTasks.length })}</span>
                    <Button variant="secondary" size="sm" onClick={openTaskPanel}>{t('pj.tasks.new')}</Button>
                  </div>
                  {filteredTasks.length > 0 ? (
                    filteredTasks.map((task) => (
                      <article className={styles.taskRow} key={task.id}>
                        <span className={styles.checkIcon}>{task.status === 'Done' ? (
                          <Icon name="check_circle" filled size={18} />
                        ) : (
                          <Icon name="circle" size={18} />
                        )}</span>
                        <div>
                          <span className={styles.taskRef}>{task.title}</span>
                          <p className={styles.taskDetail}>{task.owner}: {task.detail}</p>
                        </div>
                        <Pill variant={statusTone(task.status) === 'green' ? 'green' : 'amber'}>{task.status}</Pill>
                        <div>
                          <Button variant="secondary" size="sm" onClick={() => toggleTaskStatus(task.id)}>{taskActionLabel(task.status)}</Button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className={styles.emptyState}>
                      <strong className={styles.emptyTitle}>{t('pj.empty.noTasks')}</strong>
                      <span className={styles.emptyText}>{t('pj.empty.noTasksHint')}</span>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Files */}
              {activeView === 'files' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className={styles.filterBar}>
                    <div className={styles.filterGroup} aria-label="File type filters">
                      <span className={styles.filterLabel}>{t('pj.files.filter.label')}</span>
                      {fileFilters.map((f) => (
                        <button key={f} type="button" className={fileFilter === f ? `${styles.filterBtn} ${styles.filterBtnActive}` : styles.filterBtn} onClick={() => setFileFilter(f)}>{f}</button>
                      ))}
                    </div>
                    <div className={styles.filterGroup} aria-label="Run status filters">
                      <span className={styles.filterLabel}>{t('pj.runs.filter.label')}</span>
                      {runFilters.map((f) => (
                        <button key={f} type="button" className={runFilter === f ? `${styles.filterBtn} ${styles.filterBtnActive}` : styles.filterBtn} onClick={() => setRunFilter(f)}>{f}</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.list}>
                    {filteredFiles.length > 0 ? (
                      filteredFiles.map((file) => (
                        <article className={styles.fileRow} key={file.name}>
                          <span className={styles.fileType}>{file.type}</span>
                          <div>
                            <span className={styles.rowName}>{file.name}</span>
                            <p className={styles.rowDetail}>{file.detail}</p>
                          </div>
                          <Pill variant={statusTone(file.status) === 'green' ? 'green' : 'default'}>{file.status}</Pill>
                        </article>
                      ))
                    ) : (
                      <div className={styles.emptyState}>
                        <strong className={styles.emptyTitle}>{t('pj.empty.noFiles')}</strong>
                        <span className={styles.emptyText}>{t('pj.empty.noFilesHint')}</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.list} aria-label="Run records">
                    {filteredRuns.length > 0 ? (
                      filteredRuns.map((run) => (
                        <article className={styles.runRow} key={run.id}>
                          <span className={styles.runIcon}>RN</span>
                          <div>
                            <span className={styles.rowName}>{run.id}</span>
                            <p className={styles.rowDetail}>{run.detail}</p>
                            <div className={styles.metaLine}>
                              <Pill variant="default">{run.time}</Pill>
                            </div>
                          </div>
                          <Pill variant={statusTone(run.status) === 'green' ? 'green' : statusTone(run.status) === 'cyan' ? 'cyan' : statusTone(run.status) === 'purple' ? 'purple' : 'default'}>{run.status}</Pill>
                        </article>
                      ))
                    ) : (
                      <div className={styles.emptyState}>
                        <strong className={styles.emptyTitle}>{t('pj.empty.noRuns')}</strong>
                        <span className={styles.emptyText}>{t('pj.empty.noRunsHint')}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            {/* Side stack: milestones + risks */}
            <aside className={styles.sideStack}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>{t('pj.milestones.title')}</h3>
                  <Pill variant="default">M1</Pill>
                </div>
                <div className={styles.list}>
                  {milestones.map((ml, i) => (
                    <article className={styles.milestoneRow} key={ml.title}>
                      <span className={`${styles.milestoneDot} ${i === 1 ? styles.dotCyan : i === 2 ? styles.dotPurple : ''}`} />
                      <div>
                        <span className={styles.milestoneName}>{ml.title}</span>
                        <p className={styles.milestoneMeta}>{ml.detail}</p>
                      </div>
                      <Pill variant={statusTone(ml.status) === 'green' ? 'green' : statusTone(ml.status) === 'cyan' ? 'cyan' : 'purple'}>{ml.status}</Pill>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>{t('pj.risks.title')}</h3>
                  <Pill variant={openRiskCount === 0 ? 'green' : 'amber'}>
                    {openRiskCount === 0 ? t('pj.risks.reviewed') : t('pj.risks.needsReview')}
                  </Pill>
                </div>
                <div className={styles.list}>
                  {projectRisks.map((risk) => (
                    <article className={styles.riskRow} key={risk.id}>
                      <div>
                        <span className={styles.rowName}>{risk.title}</span>
                        <p className={styles.rowDetail}>{risk.detail}</p>
                      </div>
                      <Pill variant={risk.status === 'Reviewed' ? 'green' : risk.status === 'Tracked' ? 'cyan' : 'amber'}>{risk.status}</Pill>
                      <Button variant="secondary" size="sm" disabled={!risk.reviewable} onClick={() => toggleRisk(risk.id)}>
                        {risk.reviewable && risk.status === 'Reviewed' ? t('pj.risks.reopen') : t('pj.risks.review')}
                      </Button>
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </WebLayout>
    </div>
  );
}

export default ProjectPage;
