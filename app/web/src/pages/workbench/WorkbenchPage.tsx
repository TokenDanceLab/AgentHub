import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, Pill, Avatar, SearchInput, ProgressBar, Card } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './WorkbenchPage.module.css';

/* ── Types ────────────────────────────────────────────────── */

type PanelMode = 'preview' | 'diff' | 'approval';
type ApprovalStatus = 'idle' | 'review-requested' | 'handoff-staged' | 'approved';
type PreviewStatus = 'pending' | 'passed';
type ConfirmationTone = 'info' | 'success' | 'warning';

interface AgentCard {
  id: string;
  initials: string;
  name: string;
  paused: boolean;
  progress: number;
  role: string;
  route: string;
  status: string;
}

interface ActivityItem {
  detail: string;
  icon: string;
  id: string;
  title: string;
}

interface ConfirmationBar {
  detail: string;
  id: string;
  message: string;
  tone: ConfirmationTone;
}

interface CommandOption {
  description: string;
  disabled?: boolean;
  icon: string;
  id: string;
  run: () => void;
  shortcut: string;
  title: string;
}

interface WorkbenchSession {
  title: string;
  meta: string;
  status: 'Live' | 'Archived';
}

/* ── Constants ────────────────────────────────────────────── */

const panelLabels: PanelMode[] = ['preview', 'diff', 'approval'];

const routeOptions = [
  'Preview verification',
  'Diff validation',
  'Approval handoff',
  'Responsive sweep',
];

const mockRunnerNames = [
  { id: 'worker-01', name: 'Workbench worker', capabilities: 'Refining layout and state affordances' },
  { id: 'worker-02', name: 'Preview tester', capabilities: 'Checking responsive surfaces' },
  { id: 'worker-03', name: 'Coordinator', capabilities: 'Watching write boundaries' },
];

const initialAgents: AgentCard[] = mockRunnerNames.map((runner, i) => ({
  id: runner.id,
  initials: runner.name.split(' ').map((w) => w[0]!).join('').toUpperCase().slice(0, 2),
  name: runner.name,
  role: runner.capabilities ?? 'No capability info',
  status: 'Coding',
  route: routeOptions[i % routeOptions.length]!,
  paused: false,
  progress: 50 + Math.floor(Math.random() * 45),
}));

const sessions: WorkbenchSession[] = [
  { title: 'Workbench polish', meta: 'UI worker and tester active', status: 'Live' },
  { title: 'Preview bridge', meta: 'Waiting on interface notes', status: 'Archived' },
  { title: 'Approval queue', meta: 'Ready for owner review', status: 'Archived' },
  { title: 'Responsive sweep', meta: 'All breakpoints checked', status: 'Live' },
];

const initialActivity: ActivityItem[] = [
  { id: 'ui-1', icon: 'design_services', title: 'UI worker tightened the page hierarchy', detail: 'Cards now separate navigation, conversation, and review work without stacking decorative containers inside each other.' },
  { id: 'ui-2', icon: 'hub', title: 'Coordinator pinned the page contract', detail: 'No real API calls, no new package dependency, and all changes stay under the workbench page directory.' },
  { id: 'ui-3', icon: 'rule', title: 'Tester prepared review checks', detail: 'Diff, preview, and approval affordances are visible at the same time as session progress.' },
];

const navItems = [
  { icon: 'view_quilt', label: 'Workbench', active: true },
  { icon: 'forum', label: 'Sessions' },
  { icon: 'account_tree', label: 'Agent graph' },
  { icon: 'folder_open', label: 'Projects' },
];

/* ── Component ────────────────────────────────────────────── */

export function WorkbenchPage() {
  const { t } = useTranslation();

  const activityIdRef = useRef(initialActivity.length);
  const confirmationIdRef = useRef(0);
  const [activePanel, setActivePanel] = useState<PanelMode>('preview');
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>(initialActivity);
  const [agents, setAgents] = useState<AgentCard[]>(initialAgents);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('idle');
  const [commandQuery, setCommandQuery] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationBar | null>(null);
  const [draftInstruction, setDraftInstruction] = useState('');
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('pending');

  /* ── Activity helpers ─────────────────────────────────── */

  const pushActivity = useCallback((icon: string, title: string, detail: string) => {
    activityIdRef.current += 1;
    setActivityFeed((current) => [
      { id: `local-${activityIdRef.current}`, icon, title, detail },
      ...current,
    ].slice(0, 8));
  }, []);

  const showConfirmation = useCallback((tone: ConfirmationTone, message: string, detail: string) => {
    confirmationIdRef.current += 1;
    setConfirmation({ id: `confirm-${confirmationIdRef.current}`, tone, message, detail });
  }, []);

  /* ── Command palette ──────────────────────────────────── */

  const openCommandPanel = useCallback(() => {
    setCommandQuery('');
    setIsCommandOpen(true);
  }, []);

  const closeCommandPanel = useCallback(() => {
    setIsCommandOpen(false);
    setCommandQuery('');
  }, []);

  /* ── Actions ──────────────────────────────────────────── */

  const requestReview = useCallback((source = 'Toolbar') => {
    setApprovalStatus((current) => (current === 'approved' ? current : 'review-requested'));
    setActivePanel('approval');
    pushActivity('rate_review', 'Review requested', `${source} opened a local approval checkpoint for this workbench state.`);
    showConfirmation('info', 'Review checkpoint created', 'The approval panel is active and ready for local QA notes.');
  }, [pushActivity, showConfirmation]);

  const stageHandoff = useCallback((source = 'Task header') => {
    setApprovalStatus((current) => (current === 'approved' ? current : 'handoff-staged'));
    setActivePanel('approval');
    pushActivity('outbox', 'Handoff staged', `${source} staged the visible preview, diff, and approval notes for owner review.`);
    showConfirmation('info', 'Handoff staged locally', 'The handoff is visible in the activity stream; no external service was called.');
  }, [pushActivity, showConfirmation]);

  const approveWork = useCallback(() => {
    if (previewStatus !== 'passed') {
      setActivePanel('preview');
      pushActivity('block', 'Approval blocked', 'Preview must be checked before the local approval state can complete.');
      showConfirmation('warning', 'Preview check required', 'Mark the preview checked first, then return to approval.');
      return;
    }
    setApprovalStatus('approved');
    setActivePanel('approval');
    pushActivity('verified', 'Approval completed', 'The local approval state is now complete and action buttons reflect the final state.');
    showConfirmation('success', 'Approved locally', 'This is a visible local state only; no handoff was sent to a real API.');
  }, [previewStatus, pushActivity, showConfirmation]);

  const markPreviewChecked = useCallback(() => {
    if (previewStatus === 'passed') {
      setActivePanel('approval');
      return;
    }
    setPreviewStatus('passed');
    setApprovalStatus((current) => (current === 'idle' ? 'review-requested' : current));
    setActivePanel('approval');
    pushActivity('task_alt', 'Preview checked', 'Preview checks passed locally, so the review panel switched to approval.');
    showConfirmation('success', 'Preview checked', 'The preview status is complete and approval actions are now available.');
  }, [previewStatus, pushActivity, showConfirmation]);

  const rerouteAgent = useCallback((agentId: string, source = 'Agent controls') => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) return;

    const currentRouteIndex = routeOptions.indexOf(targetAgent.route);
    const nextRoute = routeOptions[(currentRouteIndex + 1 + routeOptions.length) % routeOptions.length]!;

    setAgents((current) => current.map((agent) =>
      agent.id === agentId
        ? { ...agent, paused: false, route: nextRoute, status: 'Rerouted', progress: Math.min(agent.progress + 4, 96) }
        : agent,
    ));

    pushActivity('alt_route', `${targetAgent.name} rerouted`, `${source} moved this agent to ${nextRoute}.`);
    showConfirmation('info', 'Agent route updated', `${targetAgent.name} is now assigned to ${nextRoute}.`);
  }, [agents, pushActivity, showConfirmation]);

  const toggleAgentPause = useCallback((agentId: string) => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) return;

    const nextPaused = !targetAgent.paused;
    setAgents((current) => current.map((agent) =>
      agent.id === agentId
        ? { ...agent, paused: nextPaused, status: nextPaused ? agent.status : agent.status === 'Paused' ? 'Coding' : agent.status }
        : agent,
    ));

    pushActivity(
      nextPaused ? 'pause_circle' : 'play_circle',
      nextPaused ? `${targetAgent.name} paused` : `${targetAgent.name} resumed`,
      nextPaused
        ? 'The local agent card now shows a paused state and keeps its current route visible.'
        : 'The local agent card returned to active work without calling a scheduler.',
    );
    showConfirmation(
      nextPaused ? 'warning' : 'success',
      nextPaused ? 'Agent paused' : 'Agent resumed',
      `${targetAgent.name} is ${nextPaused ? 'paused' : 'active'} in this local workbench state.`,
    );
  }, [agents, pushActivity, showConfirmation]);

  const openDiffPanel = useCallback(() => {
    setActivePanel('diff');
    pushActivity('difference', 'Diff panel opened', 'The inspector is showing the local illustrative diff view.');
    showConfirmation('info', 'Diff panel active', 'Review the local file summary before staging a handoff.');
  }, [pushActivity, showConfirmation]);

  const noteLocalNotifications = useCallback(() => {
    pushActivity('notifications', 'Notification drawer checked', 'There are no remote notifications in this local preview.');
    showConfirmation('info', 'No remote notifications', 'This button only updates local visible state in the activity stream.');
  }, [pushActivity, showConfirmation]);

  const queueInstruction = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draftInstruction.trim();
    if (!trimmed) {
      showConfirmation('warning', 'Instruction is empty', 'Add a short local instruction before queueing it.');
      return;
    }
    setDraftInstruction('');
    pushActivity('bolt', 'Instruction queued', trimmed);
    showConfirmation('success', 'Instruction queued locally', 'The activity stream has the new note; nothing was sent to a server.');
  }, [draftInstruction, pushActivity, showConfirmation]);

  /* ── Derived ──────────────────────────────────────────── */

  const activeAgentCount = agents.filter((a) => !a.paused).length;
  const hasApproved = approvalStatus === 'approved';
  const canApprove = previewStatus === 'passed' && !hasApproved;
  const stagedCount = approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 1 : 0;

  const approvalLabel = useMemo<Record<ApprovalStatus, { label: string; detail: string }>>(() => ({
    idle: { label: t('wb.approval.notRequested'), detail: t('wb.approval.notRequestedDetail') },
    'review-requested': { label: t('wb.approval.reviewRequested'), detail: t('wb.approval.reviewRequestedDetail') },
    'handoff-staged': { label: t('wb.approval.handoffStaged'), detail: t('wb.approval.handoffStagedDetail') },
    approved: { label: t('wb.approval.approvedStatus'), detail: t('wb.approval.approvedDetail') },
  }), [t]);

  /* ── Command options ──────────────────────────────────── */

  const commandOptions = useMemo<CommandOption[]>(() => [
    {
      id: 'route-qa', icon: 'alt_route', title: 'Route visual QA to tester',
      description: 'Moves the preview tester to the next local route and records activity.',
      shortcut: 'V', run: () => rerouteAgent('preview-tester', 'Command palette'),
    },
    {
      id: 'review-checkpoint', icon: 'rate_review', title: 'Create approval checkpoint',
      description: 'Switches to approval and appends a review request.',
      shortcut: 'A', disabled: hasApproved, run: () => requestReview('Command palette'),
    },
    {
      id: 'open-diff', icon: 'difference', title: 'Open diff panel',
      description: 'Shows the local diff panel and writes a visible trace.',
      shortcut: 'D', run: openDiffPanel,
    },
    {
      id: 'stage-handoff', icon: 'outbox', title: 'Stage handoff',
      description: 'Marks the local handoff as staged for owner review.',
      shortcut: 'H', disabled: hasApproved, run: () => stageHandoff('Command palette'),
    },
    {
      id: 'pause-primary', icon: agents[0]?.paused ? 'play_circle' : 'pause_circle',
      title: agents[0]?.paused ? 'Resume workbench worker' : 'Pause workbench worker',
      description: 'Toggles the primary agent card between active and paused.',
      shortcut: 'P', run: () => toggleAgentPause(agents[0]?.id ?? ''),
    },
  ], [agents, hasApproved, openDiffPanel, rerouteAgent, requestReview, stageHandoff, toggleAgentPause]);

  const filteredCommands = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return commandOptions;
    return commandOptions.filter((o) =>
      `${o.title} ${o.description} ${o.shortcut}`.toLowerCase().includes(q),
    );
  }, [commandOptions, commandQuery]);

  /* ── Keyboard ─────────────────────────────────────────── */

  useEffect(() => {
    if (!isCommandOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCommandPanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeCommandPanel, isCommandOpen]);

  useEffect(() => {
    const handleGlobal = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPanel();
      }
    };
    window.addEventListener('keydown', handleGlobal);
    return () => window.removeEventListener('keydown', handleGlobal);
  }, [openCommandPanel]);

  /* ── Panel Content ────────────────────────────────────── */

  const panelContent = useMemo(() => {
    if (activePanel === 'preview') {
      return (
        <section className={styles.panelStack} aria-label="Preview panel">
          <div className={styles.previewCard}>
            <div className={styles.previewToolbar}>
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.previewToolbarText}>localhost preview</span>
            </div>
            <div className={styles.previewStage}>
              <div className={styles.previewRow}>
                <div>
                  <div className={styles.previewRowTitle}>{t('wb.preview.title1')}</div>
                  <div className={styles.previewRowDesc}>{t('wb.preview.desc1')}</div>
                </div>
                <Icon name="web_asset" />
              </div>
              <div className={styles.previewRow}>
                <div>
                  <div className={styles.previewRowTitle}>{t('wb.preview.title2')}</div>
                  <div className={styles.previewRowDesc}>{t('wb.preview.desc2')}</div>
                </div>
                <Icon name="auto_awesome" />
              </div>
              <div className={styles.previewRow}>
                <div>
                  <div className={styles.previewRowTitle}>{t('wb.preview.title3')}</div>
                  <div className={styles.previewRowDesc}>
                    {previewStatus === 'passed' ? t('wb.preview.checkedDesc') : t('wb.preview.pendingDesc')}
                  </div>
                </div>
                <Pill variant={previewStatus === 'passed' ? 'green' : 'amber'}>
                  {previewStatus === 'passed' ? t('wb.preview.checked') : t('wb.preview.pending')}
                </Pill>
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={previewStatus === 'passed'}
            onClick={markPreviewChecked}
          >
            <Icon name={previewStatus === 'passed' ? 'check_circle' : 'task_alt'} />
            {previewStatus === 'passed' ? t('wb.preview.checkedLabel') : t('wb.preview.markChecked')}
          </Button>
        </section>
      );
    }

    if (activePanel === 'diff') {
      return (
        <section className={styles.panelStack} aria-label="Diff panel">
          <div className={styles.fileRow}>
            <div>
              <div className={styles.fileRowTitle}>{t('wb.diff.file1')}</div>
              <div className={styles.fileRowDesc}>{t('wb.diff.desc1')}</div>
            </div>
            <Pill>new</Pill>
          </div>
          <div className={styles.fileRow}>
            <div>
              <div className={styles.fileRowTitle}>{t('wb.diff.file2')}</div>
              <div className={styles.fileRowDesc}>{t('wb.diff.desc2')}</div>
            </div>
            <Pill>source</Pill>
          </div>
          <div className={styles.codeDiff} aria-label="Illustrative diff">
            <div className={`${styles.diffLine} ${styles.diffRemove}`}>
              <span className={styles.diffSign}>-</span>
              <span className={styles.diffText}>buttons only flipped a couple of local booleans</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>active preview, diff, and approval panel state</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>command palette writes activity and confirmation state</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>agent pause, resume, and reroute controls are visible</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>preview checks unlock the approval action path</span>
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={hasApproved}
            onClick={() => stageHandoff('Diff panel')}
          >
            <Icon name="outbox" />
            {approvalStatus === 'handoff-staged' ? t('wb.diff.alreadyStaged') : t('wb.diff.stageHandoff')}
          </Button>
        </section>
      );
    }

    return (
      <section className={styles.panelStack} aria-label="Approval panel">
        <div className={styles.statusStrip} aria-label="Approval summary">
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>{t('wb.approval.preview')}</span>
            <span className={styles.statusValue}>{previewStatus === 'passed' ? t('wb.preview.checked') : t('wb.preview.pending')}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>{t('wb.approval.approval')}</span>
            <span className={styles.statusValue}>{approvalLabel[approvalStatus].label}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>{t('wb.approval.handoff')}</span>
            <span className={styles.statusValue}>{stagedCount ? t('wb.approval.staged') : t('wb.approval.open')}</span>
          </div>
        </div>

        {approvalStatus === 'idle' && previewStatus === 'pending' ? (
          <div className={styles.emptyState} role="status">
            <span className={styles.emptyTitle}>{t('wb.approval.noCheckpoint')}</span>
            <span>{t('wb.approval.noCheckpointHint')}</span>
          </div>
        ) : null}

        <div className={styles.panelStack}>
          <div className={styles.approvalRow}>
            <span className={previewStatus === 'passed' ? styles.checkPassed : styles.checkPending}>
              <Icon name={previewStatus === 'passed' ? 'check' : 'pending'} size={16} />
            </span>
            <div>
              <div className={styles.approvalRowTitle}>{t('wb.approval.check1')}</div>
              <div className={styles.approvalRowDesc}>
                {previewStatus === 'passed' ? t('wb.approval.check1Passed') : t('wb.approval.check1Pending')}
              </div>
            </div>
          </div>
          <div className={styles.approvalRow}>
            <span className={approvalStatus !== 'idle' ? styles.checkPassed : styles.checkPending}>
              <Icon name={approvalStatus !== 'idle' ? 'check' : 'pending'} size={16} />
            </span>
            <div>
              <div className={styles.approvalRowTitle}>{t('wb.approval.check2')}</div>
              <div className={styles.approvalRowDesc}>{approvalLabel[approvalStatus].detail}</div>
            </div>
          </div>
          <div className={styles.approvalRow}>
            <span className={approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? styles.checkPassed : styles.checkPending}>
              <Icon name={approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 'check' : 'pending'} size={16} />
            </span>
            <div>
              <div className={styles.approvalRowTitle}>{t('wb.approval.check3')}</div>
              <div className={styles.approvalRowDesc}>
                {approvalStatus === 'handoff-staged' || approvalStatus === 'approved'
                  ? t('wb.approval.check3Staged')
                  : t('wb.approval.check3Open')}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.approvalActions}>
          <Button variant="secondary" disabled={hasApproved} onClick={() => requestReview('Approval panel')}>
            <Icon name="rate_review" />
            {t('wb.requestReview')}
          </Button>
          <Button variant="secondary" disabled={hasApproved} onClick={() => stageHandoff('Approval panel')}>
            <Icon name="outbox" />
            {t('wb.stageHandoff')}
          </Button>
          <Button variant="primary" disabled={!canApprove} onClick={approveWork}>
            <Icon name={hasApproved ? 'verified' : 'check_circle'} />
            {hasApproved ? t('wb.approval.approved') : t('wb.approval.approve')}
          </Button>
        </div>
      </section>
    );
  }, [
    activePanel, approvalLabel, approvalStatus, approveWork, canApprove, hasApproved,
    markPreviewChecked, previewStatus, requestReview, stageHandoff, stagedCount, t,
  ]);

  /* ── Sidebar bottom: sessions ──────────────────────────── */

  const sidebarBottom = (
    <ul className={styles.sessionList}>
      {sessions.map((session) => (
        <li className={styles.sessionItem} key={session.title}>
          <div className={styles.sessionTop}>
            <span className={styles.sessionTitle}>{session.title}</span>
            {session.status === 'Live' ? (
              <span className={styles.liveDot} />
            ) : (
              <Pill>{session.status}</Pill>
            )}
          </div>
          <span className={styles.sessionMeta}>{session.meta}</span>
        </li>
      ))}
    </ul>
  );

  /* ── Render ────────────────────────────────────────────── */

  return (
    <div className={styles.pageRoot}>
      <ParticleCanvas />

      <WebLayout
        brandName={t('wb.brand')}
        brandSubtitle={t('wb.subtitle')}
        navItems={navItems.map((item) => ({
          ...item,
          label: item.label === 'Workbench' ? t('wb.nav.workbench')
            : item.label === 'Sessions' ? t('wb.nav.sessions')
            : item.label === 'Agent graph' ? t('wb.nav.agents')
            : t('wb.nav.projects'),
        }))}
        sectionLabels={[{ text: t('wb.sessions.label'), count: sessions.length }]}
        sidebarBottom={sidebarBottom}
        sidebarAction={
          <Button variant="primary" size="md" onClick={openCommandPanel}>
            <Icon name="add_task" />
            {t('wb.newItem')}
          </Button>
        }
        topbarLeft={
          <SearchInput placeholder={t('wb.search')} />
        }
        topbarRight={
          <>
            <Pill>
              <span className={styles.liveDot} />
              {t('wb.previewOnly')}
            </Pill>
            <Button variant="icon" aria-label="Open command palette" onClick={openCommandPanel}>
              <Icon name="keyboard_command_key" />
            </Button>
            <Button variant="icon" aria-label="Notifications" onClick={noteLocalNotifications}>
              <Icon name="notifications" />
            </Button>
            <Button variant="secondary" disabled={hasApproved} onClick={() => requestReview('Top bar')}>
              <Icon name="verified" />
              {t('wb.requestReview')}
            </Button>
          </>
        }
        drawer={
          <>
            <div className={styles.inspectorHead}>
              <div className={styles.panelHeading}>
                <div>
                  <div className={styles.panelTitle}>{t('wb.inspector.title')}</div>
                  <div className={styles.panelSubtitle}>{t('wb.inspector.subtitle')}</div>
                </div>
                <Pill>{approvalLabel[approvalStatus].label}</Pill>
              </div>
              <div className={styles.tabBar} role="tablist" aria-label="Review views">
                {panelLabels.map((panel) => (
                  <button
                    key={panel}
                    type="button"
                    role="tab"
                    aria-selected={activePanel === panel}
                    className={activePanel === panel ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setActivePanel(panel)}
                  >
                    {t(`wb.panel.${panel}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.panelBody}>{panelContent}</div>
          </>
        }
      >
        <main className={styles.conversation}>
          <div className={styles.taskHead}>
            <div className={styles.taskBody}>
              <Pill>{t('wb.taskPill')}</Pill>
              <h2 className={styles.taskTitle}>{t('wb.taskTitle')}</h2>
              <p className={styles.taskCopy}>{t('wb.taskDescription')}</p>
            </div>
            <Button variant="secondary" disabled={hasApproved} onClick={() => stageHandoff('Task header')}>
              <Icon name="play_arrow" />
              {approvalStatus === 'handoff-staged' ? t('wb.handoffStaged') : t('wb.stageHandoff')}
            </Button>
          </div>

          {confirmation ? (
            <div
              className={`${styles.confirmBar} ${confirmation.tone === 'success' ? styles.confirmSuccess : confirmation.tone === 'warning' ? styles.confirmWarning : styles.confirmInfo}`}
              role="status"
            >
              <div className={styles.confirmText}>
                <span className={styles.confirmStrong}>{confirmation.message}</span>
                <span className={styles.confirmDetail}>{confirmation.detail}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setConfirmation(null)}>
                {t('wb.confirm.dismiss')}
              </Button>
            </div>
          ) : null}

          <div className={styles.metrics} aria-label="Task metrics">
            <div className={styles.metric}>
              <span className={styles.metricValue}>{6 - stagedCount}</span>
              <span className={styles.metricLabel}>{t('wb.metrics.openTasks')}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>{activeAgentCount}</span>
              <span className={styles.metricLabel}>{t('wb.metrics.agentsActive')}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>{previewStatus === 'passed' ? '0m' : '12m'}</span>
              <span className={styles.metricLabel}>{t('wb.metrics.lastUpdate')}</span>
            </div>
          </div>

          <ul className={styles.agentList} aria-label="Agent collaboration status">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className={agent.paused ? `${styles.agentCard} ${styles.agentCardPaused}` : styles.agentCard}
              >
                <div className={styles.agentTop}>
                  <Avatar initials={agent.initials} />
                  <Pill>{agent.paused ? t('wb.status.paused') : agent.status}</Pill>
                </div>
                <div className={styles.agentName}>{agent.name}</div>
                <div className={styles.agentRole}>{agent.role}</div>
                <div className={styles.agentRoute}>
                  <Icon name="alt_route" size={17} />
                  <span>{agent.route}</span>
                </div>
                <ProgressBar value={agent.progress} paused={agent.paused} />
                <div className={styles.agentActions}>
                  <Button variant="secondary" size="sm" onClick={() => toggleAgentPause(agent.id)}>
                    <Icon name={agent.paused ? 'play_circle' : 'pause_circle'} size={16} />
                    {agent.paused ? t('wb.agent.resume') : t('wb.agent.pause')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => rerouteAgent(agent.id)}>
                    <Icon name="swap_calls" size={16} />
                    {t('wb.agent.reroute')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <ol className={styles.feed} aria-label="Session activity">
            {activityFeed.length ? activityFeed.map((activity) => (
              <li className={styles.message} key={activity.id}>
                <div className={styles.messageIcon}>
                  <Icon name={activity.icon} />
                </div>
                <div>
                  <div className={styles.messageTitle}>{activity.title}</div>
                  <div className={styles.messageDetail}>{activity.detail}</div>
                </div>
              </li>
            )) : (
              <li className={styles.emptyState}>
                <span className={styles.emptyTitle}>No local activity yet</span>
                <span>Use a command, agent control, or approval action to add entries.</span>
              </li>
            )}
          </ol>

          <form className={styles.composer} onSubmit={queueInstruction}>
            <Icon name="bolt" />
            <input
              className={styles.composerInput}
              aria-label={t('wb.composer.placeholder')}
              placeholder={t('wb.composer.placeholder')}
              value={draftInstruction}
              onChange={(e) => setDraftInstruction(e.target.value)}
            />
            <Button variant="secondary" size="sm" disabled={!draftInstruction.trim()} type="submit">
              {t('wb.composer.queue')}
            </Button>
          </form>
        </main>
      </WebLayout>

      {isCommandOpen ? (
        <div
          className={styles.commandOverlay}
          role="presentation"
          onClick={(e) => { if (e.currentTarget === e.target) closeCommandPanel(); }}
        >
          <section className={styles.commandPanel} role="dialog" aria-label="Command palette">
            <Card variant="glass" padding="normal">
              <label className={styles.commandInput}>
                <Icon name="terminal" />
                <input
                  className={styles.commandInputField}
                  placeholder={t('wb.command.placeholder')}
                  autoFocus
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                />
              </label>
              <div className={styles.commandActions}>
                {filteredCommands.length ? filteredCommands.map((option) => (
                  <button
                    key={option.id}
                    className={styles.commandOption}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => { option.run(); closeCommandPanel(); }}
                  >
                    <Icon name={option.icon} size={18} />
                    <span className={styles.commandCopy}>
                      <span className={styles.commandTitle}>{option.title}</span>
                      <span className={styles.commandDesc}>{option.description}</span>
                    </span>
                    <Pill>{option.shortcut}</Pill>
                  </button>
                )) : (
                  <div className={styles.emptyState} role="status">
                    <span className={styles.emptyTitle}>{t('wb.command.noResults')}</span>
                    <span>{t('wb.command.noResultsHint')}</span>
                  </div>
                )}
              </div>
            </Card>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default WorkbenchPage;
