import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AgentHubIcon } from '@/components/icons';
import { InspectorSheet, ScreenHeader } from '@/components/layout';
import { Badge, Button, SegmentedControl, StatusPill, Surface } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';
import type { MobileAppFixture, MobileInspectorSheetMode, MobileRun } from '@/types';

type TaskPane = 'owned' | 'watching' | 'review' | 'all';
type TaskViewMode = 'list' | 'board' | 'dashboard';
type TaskStatus = 'not_started' | 'in_progress' | 'review' | 'confirm' | 'done';
type TaskTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface TasksScreenProps {
  fixture: MobileAppFixture;
  initialSheetMode?: MobileInspectorSheetMode;
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
}

interface MobileTaskItem {
  id: string;
  title: string;
  project: string;
  assignee: string;
  creator: string;
  startTime: string;
  dueDate: string;
  status: TaskStatus;
  pane: TaskPane;
  summary: string;
  run?: MobileRun;
}

const taskPaneOrder: TaskPane[] = ['owned', 'watching', 'review', 'all'];
const viewModeOrder: TaskViewMode[] = ['list', 'board', 'dashboard'];
const taskStatusOrder: TaskStatus[] = ['review', 'in_progress', 'confirm', 'not_started', 'done'];

function runStatusToTaskStatus(status: MobileRun['status']): TaskStatus {
  if (status === 'approval_required') {
    return 'review';
  }
  if (status === 'running' || status === 'queued') {
    return 'in_progress';
  }
  if (status === 'failed') {
    return 'confirm';
  }
  return 'done';
}

function taskStatusToPill(status: TaskStatus) {
  if (status === 'review' || status === 'confirm') {
    return 'waiting';
  }
  if (status === 'done') {
    return 'completed';
  }
  return 'running';
}

function taskTone(status: TaskStatus): TaskTone {
  if (status === 'review') {
    return 'warning';
  }
  if (status === 'confirm') {
    return 'danger';
  }
  if (status === 'done') {
    return 'success';
  }
  if (status === 'in_progress') {
    return 'accent';
  }
  return 'neutral';
}

function runStatusPriority(status: MobileRun['status']) {
  if (status === 'approval_required') {
    return 0;
  }
  if (status === 'failed') {
    return 1;
  }
  if (status === 'running') {
    return 2;
  }
  if (status === 'queued') {
    return 3;
  }
  return 4;
}

function runStatusEmphasis(status: MobileRun['status']) {
  if (status === 'approval_required') {
    return 'warning';
  }
  if (status === 'failed') {
    return 'danger';
  }
  return 'tint';
}

function statusPriority(status: TaskStatus) {
  return taskStatusOrder.indexOf(status);
}

function formatCompactFileName(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const fileName = segments[segments.length - 1] ?? path;
  const parent = segments[segments.length - 2];

  return parent ? `${parent}/${fileName}` : fileName;
}

function formatRisk(run: MobileRun, t: ReturnType<typeof useStrings>) {
  if (run.approvalRisk === 'critical' || run.approvalRisk === 'high') {
    return t.blocked;
  }
  if (run.approvalRisk === 'medium') {
    return t.needsAction;
  }
  if (run.approvalRisk === 'low') {
    return t.reviewApproval;
  }

  return run.statusDetail ?? run.updatedAt;
}

function projectNameForRun(run: MobileRun) {
  if (run.target.includes('mobile-rn')) {
    return 'AgentHub Mobile';
  }
  if (run.target.includes('hub-server')) {
    return 'AgentHub Hub';
  }
  if (run.target.toLowerCase().includes('mock')) {
    return 'Workspace Preview';
  }
  return 'AgentHub';
}

function createTasksFromRuns(runs: MobileRun[], t: ReturnType<typeof useStrings>): MobileTaskItem[] {
  return runs.map((run, index) => ({
    id: `task-${run.id}`,
    title: run.title,
    project: projectNameForRun(run),
    assignee: index === 0 ? 'Delicious233' : 'AgentHub',
    creator: 'TokenDance',
    startTime: index === 0 ? '14:02' : '13:40',
    dueDate: index === 0 ? t.taskDueToday : t.taskDueTomorrow,
    status: runStatusToTaskStatus(run.status),
    pane: index === 0 ? 'owned' : index === 1 ? 'watching' : 'review',
    summary: run.summary,
    run,
  }));
}

function toneColor(tone: TaskTone, tokens: ReturnType<typeof useAgentHubTheme>['tokens']) {
  return {
    neutral: tokens.color.inkMuted,
    accent: tokens.color.accent,
    success: tokens.color.moss,
    warning: tokens.color.warning,
    danger: tokens.color.danger,
  }[tone];
}

function statusLabel(status: TaskStatus, t: ReturnType<typeof useStrings>) {
  return {
    not_started: t.taskStatusNotStarted,
    in_progress: t.taskStatusInProgress,
    review: t.taskStatusReview,
    confirm: t.taskStatusConfirm,
    done: t.taskStatusDone,
  }[status];
}

function TaskStatPill({ label, value }: { label: string; value: number }): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        minWidth: 94,
        flex: 1,
        minHeight: 44,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: tokens.color.line,
        borderRadius: tokens.radius.control,
        backgroundColor: tokens.color.surfaceStrong,
        paddingHorizontal: tokens.space.sm,
      }}
    >
      <Text numberOfLines={1} style={{ color: tokens.color.inkSubtle, fontSize: tokens.type.xs, lineHeight: 15 }}>
        {label}
      </Text>
      <Text
        style={{
          color: tokens.color.ink,
          fontSize: 17,
          fontWeight: tokens.type.weight.medium,
          lineHeight: 21,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

interface TaskRowProps {
  selected: boolean;
  task: MobileTaskItem;
  onPress: () => void;
}

function TaskRow({ selected, task, onPress }: TaskRowProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const tone = taskTone(task.status);
  const activeColor = toneColor(tone, tokens);
  const run = task.run;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 68,
        flexDirection: 'row',
        gap: tokens.space.sm,
        borderLeftWidth: selected ? 2 : 0,
        borderLeftColor: selected ? activeColor : 'transparent',
        borderRadius: selected ? tokens.radius.control : 0,
        backgroundColor: pressed ? tokens.color.tint : selected ? tokens.color.tint : tokens.color.panel,
        opacity: pressed ? 0.86 : 1,
        paddingHorizontal: tokens.space.sm,
        paddingVertical: 7,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          backgroundColor: tone === 'warning' ? tokens.color.warningSoft : tokens.color.accentSoft,
        }}
      >
        <AgentHubIcon color={activeColor} name={tone === 'warning' ? 'approval' : 'runs'} size={16} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: tokens.color.ink,
              fontSize: tokens.type.sm,
              fontWeight: tokens.type.weight.medium,
              lineHeight: tokens.type.lineHeight.sm,
              includeFontPadding: false,
            }}
          >
            {task.title}
          </Text>
          <StatusPill status={taskStatusToPill(task.status)} />
        </View>
        <Text numberOfLines={1} style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
          {task.project} · {task.assignee} · {task.dueDate}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.color.inkSubtle, fontSize: tokens.type.xs, lineHeight: 15 }}>
          {run?.changedFiles.length ? `${run.changedFiles.length} ${t.taskEvidenceFiles}` : task.summary}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
          <Badge label={statusLabel(task.status, t)} size="micro" />
          {run?.evidenceCount ? <Badge label={`${run.evidenceCount} ${t.taskEvidence}`} size="micro" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

interface DetailChipProps {
  icon: 'approval' | 'diff' | 'file' | 'clock' | 'cloud' | 'runs';
  label: string;
  value: string;
  tone?: TaskTone;
}

function DetailChip({ icon, label, value, tone = 'neutral' }: DetailChipProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const activeColor = toneColor(tone, tokens);

  return (
    <View
      style={{
        minHeight: 34,
        flex: 1,
        minWidth: 132,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderTopWidth: 1,
        borderTopColor: tokens.color.line,
        paddingVertical: 6,
      }}
    >
      <AgentHubIcon color={activeColor} name={icon} size={16} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: tokens.color.inkSubtle, fontSize: 11, lineHeight: 14 }}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: tokens.color.ink,
            fontSize: 13,
            fontWeight: tokens.type.weight.medium,
            lineHeight: 17,
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function FilePreviewRow({ file }: { file: string }): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderTopWidth: 1,
        borderTopColor: tokens.color.line,
        paddingVertical: tokens.space.xs,
      }}
    >
      <AgentHubIcon color={tokens.color.inkSubtle} name="file" size={15} />
      <Text numberOfLines={1} style={{ flex: 1, color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
        {formatCompactFileName(file)}
      </Text>
    </View>
  );
}

function TaskBoardColumn({ status, tasks, onSelect }: { status: TaskStatus; tasks: MobileTaskItem[]; onSelect: (task: MobileTaskItem) => void }) {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <Surface style={{ minWidth: 210, flex: 1, padding: tokens.space.sm }}>
      <View style={{ gap: tokens.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.sm }}>
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.medium }}>
            {statusLabel(status, t)}
          </Text>
          <Badge label={`${tasks.length}`} size="micro" />
        </View>
        {tasks.map((task) => (
          <TaskRow key={task.id} onPress={() => onSelect(task)} selected={false} task={task} />
        ))}
      </View>
    </Surface>
  );
}

export function TasksScreen({
  fixture,
  initialSheetMode,
  selectedRunId,
  onSelectRun,
}: TasksScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const [activePane, setActivePane] = useState<TaskPane>('owned');
  const [viewMode, setViewMode] = useState<TaskViewMode>('list');
  const [sheetMode, setSheetMode] = useState<MobileInspectorSheetMode>(initialSheetMode ?? 'review');
  const [sheetVisible, setSheetVisible] = useState(Boolean(initialSheetMode));
  const tasks = useMemo(() => createTasksFromRuns(fixture.runs, t), [fixture.runs, t]);
  const selectedTask = tasks.find((task) => task.run?.id === selectedRunId) ?? tasks[0];
  const selectedRun = selectedTask?.run;
  const visibleTasks = tasks
    .filter((task) => activePane === 'all' || task.pane === activePane)
    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status));
  const incompleteCount = tasks.filter((task) => task.status !== 'done').length;
  const dueTodayCount = tasks.filter((task) => task.dueDate === t.taskDueToday).length;
  const crossProjectCount = new Set(tasks.map((task) => task.project)).size;
  const sortedRuns = [...fixture.runs].sort((a, b) => runStatusPriority(a.status) - runStatusPriority(b.status));
  const openSheet = (mode: MobileInspectorSheetMode) => {
    setSheetMode(mode);
    setSheetVisible(true);
  };
  const selectTask = (task: MobileTaskItem) => {
    if (task.run) {
      onSelectRun(task.run.id);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader eyebrow={t.tasksEyebrow} title={t.tasksTitle} description={t.tasksDescription} />
      <ScrollView contentContainerStyle={{ gap: tokens.space.sm, padding: tokens.space.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: 420 }}>
            <SegmentedControl
              onChange={setActivePane}
              options={taskPaneOrder.map((pane) => ({ label: {
                owned: t.taskPaneOwned,
                watching: t.taskPaneWatching,
                review: t.taskPaneReview,
                all: t.taskPaneAll,
              }[pane], value: pane }))}
              value={activePane}
            />
          </View>
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
          <TaskStatPill label={t.taskStatIncomplete} value={incompleteCount} />
          <TaskStatPill label={t.taskStatDueToday} value={dueTodayCount} />
          <TaskStatPill label={t.taskStatProjects} value={crossProjectCount} />
        </View>

        <SegmentedControl
          onChange={setViewMode}
          options={viewModeOrder.map((mode) => ({ label: {
            list: t.taskViewList,
            board: t.taskViewBoard,
            dashboard: t.taskViewDashboard,
          }[mode], value: mode }))}
          value={viewMode}
        />

        {viewMode === 'list' ? (
          <View
            style={{
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: tokens.color.line,
              borderRadius: tokens.radius.panel,
              backgroundColor: tokens.color.panel,
            }}
          >
            {visibleTasks.map((task) => (
              <TaskRow key={task.id} onPress={() => selectTask(task)} selected={task.id === selectedTask?.id} task={task} />
            ))}
          </View>
        ) : null}

        {viewMode === 'board' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
              {taskStatusOrder.map((status) => (
                <TaskBoardColumn
                  key={status}
                  onSelect={selectTask}
                  status={status}
                  tasks={visibleTasks.filter((task) => task.status === status)}
                />
              ))}
            </View>
          </ScrollView>
        ) : null}

        {viewMode === 'dashboard' ? (
          <Surface style={{ padding: tokens.space.md }}>
            <View style={{ gap: tokens.space.sm }}>
              <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.medium }}>
                {t.taskDashboardTitle}
              </Text>
              {sortedRuns.map((run) => (
                <Pressable
                  accessibilityRole="button"
                  key={run.id}
                  onPress={() => onSelectRun(run.id)}
                  style={{
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: tokens.space.sm,
                    borderTopWidth: 1,
                    borderTopColor: tokens.color.line,
                    paddingVertical: tokens.space.xs,
                  }}
                >
                  <AgentHubIcon color={tokens.color.accent} name="diff" size={15} />
                  <Text numberOfLines={1} style={{ flex: 1, color: tokens.color.inkMuted, fontSize: tokens.type.xs }}>
                    {run.title}
                  </Text>
                  <Badge label={`${run.changedFiles.length} ${t.fileBadge}`} size="micro" />
                </Pressable>
              ))}
            </View>
          </Surface>
        ) : null}

        {selectedTask && selectedRun ? (
          <Surface emphasis={runStatusEmphasis(selectedRun.status)} style={{ padding: tokens.space.md }}>
            <View style={{ gap: tokens.space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
                <AgentHubIcon color={toneColor(taskTone(selectedTask.status), tokens)} name="runs" size={18} />
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: tokens.color.ink,
                    fontSize: tokens.type.base,
                    fontWeight: tokens.type.weight.medium,
                    lineHeight: tokens.type.lineHeight.base,
                    includeFontPadding: false,
                  }}
                >
                  {selectedTask.title}
                </Text>
                <StatusPill status={taskStatusToPill(selectedTask.status)} />
              </View>
              <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
                {selectedTask.summary}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: tokens.space.md }}>
                <DetailChip icon="runs" label={t.taskAssignee} value={selectedTask.assignee} />
                <DetailChip icon="cloud" label={t.projectOverview} tone="accent" value={selectedTask.project} />
                <DetailChip icon="approval" label={t.taskEvidenceStatus} tone={taskTone(selectedTask.status)} value={formatRisk(selectedRun, t)} />
                <DetailChip icon="file" label={t.changedFiles} value={`${selectedRun.changedFiles.length} ${t.fileBadge}`} />
              </View>
              {selectedRun.status === 'approval_required' ? (
                <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
                  <Button label={t.approve} onPress={() => openSheet('approveConfirm')} style={{ flex: 1 }} variant="primary" />
                  <Button label={t.reject} onPress={() => openSheet('rejectConfirm')} style={{ flex: 1 }} variant="danger" />
                </View>
              ) : null}
              {selectedRun.status === 'failed' ? <Button label={t.retry} onPress={() => openSheet('approvalError')} variant="danger" /> : null}
            </View>
          </Surface>
        ) : null}

        {selectedRun ? (
          <Surface style={{ padding: tokens.space.md }}>
            <View style={{ gap: tokens.space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.sm }}>
                <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.medium }}>
                  {t.taskEvidenceFiles}
                </Text>
                <Badge label={`${selectedRun.changedFiles.length} ${t.fileBadge}`} size="micro" />
              </View>
              {selectedRun.changedFiles.map((file) => (
                <FilePreviewRow file={file} key={file} />
              ))}
            </View>
          </Surface>
        ) : null}
      </ScrollView>
      <InspectorSheet mode={sheetMode} run={selectedRun} visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </View>
  );
}
