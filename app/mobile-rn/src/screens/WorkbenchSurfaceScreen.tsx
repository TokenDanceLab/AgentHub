import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { ScreenHeader } from '@/components/layout';
import { Badge, MotionPressable, SearchField, SegmentedControl, Surface } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useNativeCapabilities } from '@/integrations/useNativeCapabilities';
import { useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

type WorkbenchSurface = 'contacts' | 'docs' | 'agents' | 'projects' | 'settings' | 'more';
type SurfacePane = string;

interface WorkbenchSurfaceScreenProps {
  surface: WorkbenchSurface;
  pendingReviews: number;
  onNavigate: (tab: MobileTab) => void;
  onOpenAccount: () => void;
}

interface SurfaceMetric {
  label: string;
  value: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

interface SurfaceRow {
  icon: AgentHubIconName;
  title: string;
  subtitle: string;
  meta: string;
  target?: MobileTab;
  onPress?: () => void;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

interface SurfaceSection {
  title: string;
  description?: string;
  rows: SurfaceRow[];
}

interface SurfaceConfig {
  eyebrow: string;
  title: string;
  description: string;
  searchPlaceholder?: string;
  variant?: 'standard' | 'overflow';
  panes: Array<{ label: string; value: SurfacePane }>;
  metrics: SurfaceMetric[];
  sections: Record<SurfacePane, SurfaceSection[]>;
}

const initialPaneBySurface: Record<WorkbenchSurface, SurfacePane> = {
  contacts: 'members',
  docs: 'recent',
  agents: 'installed',
  projects: 'overview',
  settings: 'workspace',
  more: 'shortcuts',
};

export function WorkbenchSurfaceScreen({
  surface,
  pendingReviews,
  onNavigate,
  onOpenAccount,
}: WorkbenchSurfaceScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const nativeCapabilities = useNativeCapabilities();
  const [paneBySurface, setPaneBySurface] = useState<Record<WorkbenchSurface, SurfacePane>>(initialPaneBySurface);
  const [query, setQuery] = useState('');
  const config = getSurfaceConfig(surface, pendingReviews, onOpenAccount, nativeCapabilities, t);
  const activePane = paneBySurface[surface] ?? config.panes[0]?.value ?? 'default';
  const sections = filterSections(config.sections[activePane] ?? [], query);
  const showSearch = Boolean(config.searchPlaceholder);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.panel }}>
      <ScreenHeader
        eyebrow={config.eyebrow}
        title={config.title}
        description={config.description}
      />
      <ScrollView
        contentContainerStyle={{
          gap: tokens.space.md,
          padding: tokens.space.md,
          paddingBottom: tokens.space.xl,
        }}
      >
        {showSearch ? (
          <SearchField
            placeholder={config.searchPlaceholder ?? t.search}
            value={query}
            onChangeText={setQuery}
          />
        ) : null}
        {config.panes.length > 4 ? (
          <PaneTabRail
            options={config.panes}
            value={activePane}
            onChange={(value) => {
              setPaneBySurface((current) => ({ ...current, [surface]: value }));
            }}
          />
        ) : config.panes.length > 1 ? (
          <SegmentedControl
            options={config.panes}
            value={activePane}
            onChange={(value) => {
              setPaneBySurface((current) => ({ ...current, [surface]: value }));
            }}
          />
        ) : null}
        {config.metrics.length > 0 ? <MetricStrip metrics={config.metrics} /> : null}
        {sections.map((section) => (
          config.variant === 'overflow' ? (
            <OverflowSectionView
              key={section.title}
              section={section}
              onNavigate={onNavigate}
            />
          ) : (
            <SurfaceSectionView
              key={section.title}
              section={section}
              onNavigate={onNavigate}
            />
          )
        ))}
      </ScrollView>
    </View>
  );
}

function filterSections(sections: SurfaceSection[], query: string): SurfaceSection[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return sections;
  }

  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => (
        row.title.toLowerCase().includes(normalizedQuery)
        || row.subtitle.toLowerCase().includes(normalizedQuery)
        || row.meta.toLowerCase().includes(normalizedQuery)
      )),
    }))
    .filter((section) => section.rows.length > 0);
}

function getSurfaceConfig(
  surface: WorkbenchSurface,
  pendingReviews: number,
  onOpenAccount: () => void,
  nativeCapabilities: ReturnType<typeof useNativeCapabilities>,
  t: ReturnType<typeof useStrings>,
): SurfaceConfig {
  const configs: Record<WorkbenchSurface, SurfaceConfig> = {
    contacts: {
      eyebrow: t.contactsEyebrow,
      title: t.contacts,
      description: t.contactsDescription,
      searchPlaceholder: t.searchContacts,
      panes: [
        { label: t.orgContacts, value: 'members' },
        { label: t.externalContacts, value: 'external' },
        { label: t.starredContacts, value: 'starred' },
      ],
      metrics: [
        { label: t.orgContacts, value: '12', tone: 'accent' },
        { label: t.external, value: '3' },
        { label: t.pinned, value: '5', tone: 'warning' },
      ],
      sections: {
        members: [
          {
            title: t.orgContacts,
            description: t.orgContactsDescription,
            rows: [
              row('team', 'TokenDance', t.mobileProjectDescription, 'Workspace', 'chat'),
              row('agent', 'AgentHub Profile', t.builderProfileDescription, t.agentProfile, 'agents'),
              row('shield', 'AgentHub Review Profile', t.reviewerProfileDescription, t.agentProfile, 'agents'),
            ],
          },
        ],
        external: [
          {
            title: t.externalContacts,
            description: t.externalContactsDescription,
            rows: [
              row('invite', 'TokenDance external access', t.contactsExternalPartnerDescription, t.external),
              row('cloud', 'AgentHub service desk', t.contactsSupportDeskDescription, t.external),
            ],
          },
        ],
        starred: [
          {
            title: t.starredContacts,
            description: t.starredContactsDescription,
            rows: [
              row('star', 'Alice', 'TokenDance', t.pinned, 'account', onOpenAccount),
              row('star', 'AgentHub Mobile Workbench', t.mobileProjectDescription, t.pinned, 'chat'),
            ],
          },
        ],
      },
    },
    docs: {
      eyebrow: t.docsEyebrow,
      title: t.cloudDocs,
      description: t.docsDescription,
      searchPlaceholder: t.searchDocs,
      panes: [
        { label: t.docsRecent, value: 'recent' },
        { label: t.docsOwned, value: 'owned' },
        { label: t.docsShared, value: 'shared' },
        { label: t.docsStarred, value: 'starred' },
      ],
      metrics: [
        { label: t.docsRecent, value: '6', tone: 'accent' },
        { label: t.docsOwned, value: '4' },
        { label: t.docsStarred, value: '2', tone: 'warning' },
      ],
      sections: {
        recent: [
          {
            title: t.docsRecent,
            description: t.docsDescription,
            rows: [
              row('diff', t.runEvidenceDocs, t.runEvidenceDocsDescription, t.updatedToday, 'tasks'),
              row('file', t.projectDocs, t.projectDocsDescription, t.ownerTokenDance),
              row('cloud', t.knowledgeBase, t.knowledgeBaseDescription, 'AgentHub'),
            ],
          },
        ],
        owned: [
          {
            title: t.docsOwned,
            rows: [
              row('file', t.projectDocs, t.docsRetentionDescription, t.ownerTokenDance),
              row('file', t.runEvidenceDocs, t.projectDocsDescription, t.ownerAgentHub),
            ],
          },
        ],
        shared: [
          {
            title: t.docsShared,
            rows: [
              row('cloud', t.sharedWorkbenchDesignNotes, t.workbenchProjectDescription, t.sharedStatus),
              row('cloud', t.tokenDanceIdRelyingParty, t.docsIdentityBoundaryDescription, t.sharedStatus),
            ],
          },
        ],
        starred: [
          {
            title: t.docsStarred,
            rows: [
              row('star', 'AgentHub Design Contract', t.docsDesignContractDescription, t.pinnedStatus),
              row('star', t.projectRunEvidence, t.runEvidenceDocsDescription, t.pinnedStatus, 'tasks'),
            ],
          },
        ],
      },
    },
    agents: {
      eyebrow: t.agentsEyebrow,
      title: t.agentProfilesTitle,
      description: t.agentsDescription,
      searchPlaceholder: t.searchAgentProfiles,
      panes: [
        { label: t.agentsInstalled, value: 'installed' },
        { label: t.agentsMarket, value: 'market' },
        { label: t.agentsPolicy, value: 'policy' },
        { label: t.agentsTools, value: 'tools' },
        { label: t.agentsModels, value: 'models' },
        { label: t.agentsAudit, value: 'audit' },
      ],
      metrics: [
        { label: t.agentsInstalled, value: '4', tone: 'accent' },
        { label: t.agentsTools, value: '7' },
        { label: t.agentsPolicy, value: String(pendingReviews), tone: pendingReviews > 0 ? 'warning' : 'success' },
      ],
      sections: {
        installed: [
          {
            title: t.agentsInstalled,
            description: t.agentsInstalledDescription,
            rows: [
              row('agent', t.builderProfile, t.builderProfileDescription, t.agentProfile),
              row('shield', t.reviewerProfile, t.reviewerProfileDescription, t.agentProfile, 'tasks'),
              row('file', t.docsProfile, t.docsProfileDescription, t.agentConfiguration, 'docs'),
              row('approval', t.approvalPolicy, t.approvalPolicyDescription, t.reviewRequired, 'tasks'),
            ],
          },
        ],
        market: [
          {
            title: t.agentsMarket,
            description: t.agentsMarketDescription,
            rows: [
              row('plusCircle', 'AgentHub Visual QA Profile', t.agentsMarketQaDescription, t.official),
              row('plusCircle', 'AgentHub Docs Profile', t.agentsMarketDocsDescription, t.official),
            ],
          },
        ],
        policy: [
          {
            title: t.agentsPolicy,
            description: t.agentsPolicyDescription,
            rows: [
              row('approval', t.approvalPolicy, t.approvalPolicyDescription, t.tasks, 'tasks'),
              row('shield', t.highRiskWrites, t.highRiskWritesDescription, t.reviewRequired, 'tasks'),
            ],
          },
        ],
        tools: [
          {
            title: t.agentsTools,
            rows: [
              row('diff', t.diffPreviewTool, t.runEvidenceDocsDescription, t.reviewRequired),
              row('browser', t.browserPreview, t.browserPreviewDescription, t.reviewRequired),
              row('file', t.readonlyFilePreview, t.docsRetentionDescription, t.done),
            ],
          },
        ],
        models: [
          {
            title: t.agentsModels,
            rows: [
              row('cloud', t.defaultModelRoute, t.agentsModelRouteDescription, t.selected),
              row('status', t.fallbackRoute, t.agentsModelFallbackDescription, t.needsAction),
            ],
          },
        ],
        audit: [
          {
            title: t.agentsAudit,
            rows: [
              row('clock', t.approvalDecisionAudit, t.agentsAuditApprovalDescription, t.tasks),
              row('shield', t.toolPermissionAudit, t.agentsAuditToolDescription, t.reviewRequired),
            ],
          },
        ],
      },
    },
    projects: {
      eyebrow: t.projectsEyebrow,
      title: t.projects,
      description: t.projectsDescription,
      searchPlaceholder: t.searchProjects,
      panes: [
        { label: t.projectOverview, value: 'overview' },
        { label: t.projectRuns, value: 'runs' },
        { label: t.projectArtifacts, value: 'artifacts' },
        { label: t.projectArchive, value: 'archive' },
        { label: t.projectSettings, value: 'settings' },
      ],
      metrics: [
        { label: t.projectRuns, value: '3', tone: 'accent' },
        { label: t.projectArtifacts, value: '5' },
        { label: t.reviewRequired, value: String(pendingReviews), tone: pendingReviews > 0 ? 'warning' : 'success' },
      ],
      sections: {
        overview: [
          {
            title: 'AgentHub Mobile Workbench',
            description: t.mobileProjectDescription,
            rows: [
              row('chat', 'AgentHub Mobile Workbench', t.mobileProjectDescription, t.activeStatus, 'chat'),
              row('team', 'TokenDance Review Space', t.projectMembersDescription, t.membersCount, 'contacts'),
              row('info', t.projectAnnouncement, t.projectAnnouncementDescription, t.pinned),
            ],
          },
        ],
        runs: [
          {
            title: t.projectRuns,
            description: t.tasksDescription,
            rows: [
              row('runs', t.reviewQueueTriage, t.approvalConfirmDescription, t.reviewRequired, 'tasks'),
              row('diff', t.designContractUpdate, t.runEvidenceDocsDescription, t.done, 'tasks'),
              row('browser', t.workspaceEvidenceReview, t.browserPreviewDescription, t.runningStatus, 'tasks'),
            ],
          },
        ],
        artifacts: [
          {
            title: t.projectArtifacts,
            rows: [
              row('file', t.projectDocs, t.projectDocsDescription, t.cloudDocs, 'docs'),
              row('diff', t.projectRunEvidence, t.runEvidenceDocsDescription, t.cloudDocs, 'docs'),
              row('browser', t.agentHubMobilePreview, t.browserPreviewDescription, t.cloudDocs, 'docs'),
            ],
          },
        ],
        archive: [
          {
            title: t.projectArchive,
            rows: [
              row('file', 'AgentHub Docs Space', t.projectDocsDescription, t.cloudDocs, 'docs'),
              row('shield', t.archivedProjectEvidence, t.docsRetentionDescription, t.done),
            ],
          },
        ],
        settings: [
          {
            title: t.projectSettings,
            description: t.projectSettingsDescription,
            rows: [
              row('team', t.projectMembers, t.projectMembersDescription, 'TokenDance', 'contacts'),
              row('bell', t.notifications, t.workspaceSettingsDescription, t.settings),
              row('approval', t.approvalPolicy, t.approvalPolicyDescription, t.tasks, 'tasks'),
            ],
          },
        ],
      },
    },
    settings: {
      eyebrow: t.settingsEyebrow,
      title: t.settings,
      description: t.settingsDescription,
      panes: [
        { label: t.settingsTabWorkspace, value: 'workspace' },
        { label: t.appearanceSettings, value: 'appearance' },
        { label: t.notifications, value: 'notifications' },
        { label: t.settingsTabDevice, value: 'device' },
        { label: t.agentDefaults, value: 'agent-defaults' },
        { label: t.localRuntimeState, value: 'runtime' },
        { label: t.settingsTabIdentity, value: 'identity' },
        { label: t.approvalPolicy, value: 'approval' },
      ],
      metrics: [
        { label: t.hubSession, value: t.signedIn, tone: 'success' },
        { label: t.notifications, value: t.needsAction, tone: 'warning' },
        { label: t.approvalPolicy, value: String(pendingReviews), tone: pendingReviews > 0 ? 'warning' : 'success' },
      ],
      sections: {
        workspace: [
          {
            title: t.workspaceSettings,
            description: t.workspaceSettingsDescription,
            rows: [
              row('settings', t.workspaceSettings, t.workspaceSettingsDescription, 'AgentHub'),
              row('file', t.docsRetention, t.docsRetentionDescription, t.cloudDocs, 'docs'),
            ],
          },
        ],
        appearance: [
          {
            title: t.appearanceSettings,
            description: t.appearanceSettingsDescription,
            rows: [
              row('settings', t.themeSystem, t.appearanceSystemDescription, t.selected),
              row('settings', t.themeLight, t.appearanceLightDescription, t.done),
              row('settings', t.themeOled, t.appearanceOledDescription, t.account, 'account', onOpenAccount),
            ],
          },
        ],
        notifications: [
          {
            title: t.notifications,
            description: t.notificationSettingsDescription,
            rows: [
              row('bell', t.notificationPermission, t.notificationPermissionDescription, t.needsAction, 'account', onOpenAccount),
              row('approval', t.approvalNotifications, t.approvalNotificationsDescription, t.reviewRequired, 'tasks'),
              row('runs', t.taskDigestNotifications, t.taskDigestNotificationsDescription, t.tasks, 'tasks'),
            ],
          },
        ],
        device: [
          {
            title: t.nativeDeviceCapabilities,
            description: t.nativeDeviceCapabilitiesDescription,
            rows: [
              row(
                'camera',
                t.cameraEvidenceCapture,
                t.cameraEvidenceCaptureDescription,
                formatNativePermissionMeta(nativeCapabilities.status.camera, t),
                undefined,
                nativeCapabilities.capturePhoto,
              ),
              row(
                'image',
                t.photoEvidencePicker,
                t.photoEvidencePickerDescription,
                formatNativePermissionMeta(nativeCapabilities.status.photos, t),
                undefined,
                nativeCapabilities.pickMedia,
              ),
              row(
                'file',
                t.documentEvidencePicker,
                t.documentEvidencePickerDescription,
                formatNativeLastActionMeta(nativeCapabilities.status, 'documents', t),
                undefined,
                nativeCapabilities.pickDocument,
              ),
              row('hardDrive', t.storageBudget, t.storageBudgetDescription, nativeCapabilities.status.storageLabel),
              row(
                'trash',
                t.evidenceCache,
                t.evidenceCacheDescription,
                formatNativeLastActionMeta(nativeCapabilities.status, 'clearCache', t),
                undefined,
                nativeCapabilities.clearCache,
              ),
            ],
          },
        ],
        'agent-defaults': [
          {
            title: t.agentDefaults,
            description: t.agentDefaultsDescription,
            rows: [
              row('agent', t.defaultAgentProfile, t.defaultAgentProfileDescription, t.agentProfile, 'agents'),
              row('cloud', t.defaultModelRoute, t.agentsModelRouteDescription, t.agentConfiguration, 'agents'),
              row('shield', t.highRiskWrites, t.highRiskWritesDescription, t.reviewRequired, 'tasks'),
            ],
          },
        ],
        runtime: [
          {
            title: t.localRuntimeState,
            description: t.localRuntimeStateDescription,
            rows: [
              row('status', t.nativeBuildReadiness, t.nativeBuildReadinessDescription, t.needsAction),
              row('cloud', t.mockHubTarget, t.mockHubTargetDescription, t.done),
              row('shield', t.secureStoreReadiness, t.secureStoreReadinessDescription, t.needsAction, 'account', onOpenAccount),
              row(
                'camera',
                t.nativeMediaReadiness,
                t.nativeMediaReadinessDescription,
                nativeCapabilities.status.ready ? t.done : t.unavailable,
                'settings',
              ),
            ],
          },
        ],
        identity: [
          {
            title: t.identityAndSession,
            rows: [
              row('shield', t.tokenDanceIdentity, t.hubSessionSettingsDescription, t.account, 'account', onOpenAccount),
              row('cloud', t.hubSession, t.hubSessionSettingsDescription, t.signedIn, 'account', onOpenAccount),
            ],
          },
        ],
        approval: [
          {
            title: t.approvalPolicy,
            rows: [
              row('approval', t.approvalPolicy, t.approvalPolicyDescription, t.tasks, 'tasks'),
              row('shield', t.highRiskWrites, t.highRiskWritesDescription, t.reviewRequired, 'tasks'),
            ],
          },
        ],
      },
    },
    more: {
      eyebrow: t.moreEyebrow,
      title: t.more,
      description: t.moreDescription,
      variant: 'overflow',
      panes: [{ label: t.more, value: 'shortcuts' }],
      metrics: [],
      sections: {
        shortcuts: [
          {
            title: t.workspaceName,
            rows: [
              row('team', t.contacts, t.moreContactsDescription, 'TokenDance', 'contacts'),
              row('agent', t.agentProfilesTitle, t.agentsDescription, t.agentProfile, 'agents'),
              row('settings', t.settings, t.moreSettingsDescription, t.settings, 'settings'),
            ],
          },
          {
            title: t.profileActions,
            rows: [
              row('account', t.profileAndAccount, t.moreAccountDescription, t.account, 'account', onOpenAccount),
            ],
          },
        ],
      },
    },
  };

  return configs[surface];
}

function formatNativePermissionMeta(
  state: ReturnType<typeof useNativeCapabilities>['status']['camera'],
  t: ReturnType<typeof useStrings>,
): string {
  if (state === 'granted') {
    return t.done;
  }
  if (state === 'blocked') {
    return t.blocked;
  }
  if (state === 'prompt') {
    return t.needsAction;
  }

  return t.unavailable;
}

function formatNativeLastActionMeta(
  status: ReturnType<typeof useNativeCapabilities>['status'],
  action: NonNullable<ReturnType<typeof useNativeCapabilities>['status']['lastAction']>['action'],
  t: ReturnType<typeof useStrings>,
): string {
  if (status.lastAction?.action !== action) {
    return status.ready ? t.ready : t.unavailable;
  }

  if (!status.lastAction.success) {
    return t.needsAction;
  }

  if (status.lastAction.count !== undefined) {
    return `${status.lastAction.count} ${t.taskEvidence}`;
  }

  return t.done;
}

function row(
  icon: AgentHubIconName,
  title: string,
  subtitle: string,
  meta: string,
  target?: MobileTab,
  onPress?: () => void,
): SurfaceRow {
  return {
    icon,
    title,
    subtitle,
    meta,
    ...(target ? { target } : {}),
    ...(onPress ? { onPress } : {}),
  };
}

function MetricStrip({ metrics }: { metrics: SurfaceMetric[] }): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
      {metrics.map((metric) => (
        <Surface
          key={metric.label}
          emphasis="tint"
          style={{
            flex: 1,
            minHeight: 58,
            justifyContent: 'center',
            gap: 2,
            paddingHorizontal: tokens.space.sm,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: tokens.color.inkSubtle,
              fontSize: tokens.type.xs,
              lineHeight: tokens.type.lineHeight.xs,
            }}
          >
            {metric.label}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: metric.tone === 'warning'
                ? tokens.color.warning
                : metric.tone === 'danger'
                  ? tokens.color.danger
                  : metric.tone === 'success'
                    ? tokens.color.moss
                    : tokens.color.ink,
              fontSize: tokens.type.base,
              fontWeight: tokens.type.weight.semibold,
              lineHeight: tokens.type.lineHeight.base,
            }}
          >
            {metric.value}
          </Text>
        </Surface>
      ))}
    </View>
  );
}

function PaneTabRail({
  options,
  value,
  onChange,
}: {
  options: Array<{ label: string; value: SurfacePane }>;
  value: SurfacePane;
  onChange: (value: SurfacePane) => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: tokens.space.xs,
        paddingRight: tokens.space.sm,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <MotionPressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            feedback="control"
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              minHeight: tokens.touch.minimum,
              minWidth: 86,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: selected ? tokens.color.accent : tokens.color.line,
              borderRadius: tokens.radius.control,
              backgroundColor: selected
                ? tokens.color.tint
                : pressed
                  ? tokens.color.surfaceStrong
                  : tokens.color.surface,
              paddingHorizontal: tokens.space.sm,
            })}
          >
            <Text
              numberOfLines={1}
              style={{
                color: selected ? tokens.color.accent : tokens.color.inkMuted,
                fontSize: tokens.type.sm,
                fontWeight: selected ? tokens.type.weight.semibold : tokens.type.weight.medium,
                lineHeight: tokens.type.lineHeight.sm,
              }}
            >
              {option.label}
            </Text>
          </MotionPressable>
        );
      })}
    </ScrollView>
  );
}

function SurfaceSectionView({
  section,
  onNavigate,
}: {
  section: SurfaceSection;
  onNavigate: (tab: MobileTab) => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View style={{ gap: tokens.space.xs }}>
      <View style={{ gap: 2 }}>
        <Text
          style={{
            color: tokens.color.ink,
            fontSize: tokens.type.sm,
            fontWeight: tokens.type.weight.semibold,
            lineHeight: tokens.type.lineHeight.sm,
          }}
        >
          {section.title}
        </Text>
        {section.description ? (
          <Text
            style={{
              color: tokens.color.inkMuted,
              fontSize: tokens.type.xs,
              lineHeight: tokens.type.lineHeight.xs,
            }}
          >
            {section.description}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: tokens.color.line,
          borderRadius: tokens.radius.panel,
          backgroundColor: tokens.color.panel,
        }}
      >
        {section.rows.map((rowItem, index) => (
          <SurfaceListRow
            key={`${section.title}-${rowItem.title}`}
            row={rowItem}
            showTopBorder={index > 0}
            onPress={() => {
              if (rowItem.onPress) {
                rowItem.onPress();
                return;
              }
              if (rowItem.target) {
                onNavigate(rowItem.target);
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

function OverflowSectionView({
  section,
  onNavigate,
}: {
  section: SurfaceSection;
  onNavigate: (tab: MobileTab) => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View style={{ gap: tokens.space.xs }}>
      <Text
        style={{
          color: tokens.color.inkSubtle,
          fontSize: tokens.type.xs,
          fontWeight: tokens.type.weight.semibold,
          lineHeight: tokens.type.lineHeight.xs,
        }}
      >
        {section.title}
      </Text>
      <View>
        {section.rows.map((rowItem, index) => (
          <OverflowListRow
            key={`${section.title}-${rowItem.title}`}
            row={rowItem}
            showTopBorder={index > 0}
            onPress={() => {
              if (rowItem.onPress) {
                rowItem.onPress();
                return;
              }
              if (rowItem.target) {
                onNavigate(rowItem.target);
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

function SurfaceListRow({
  row,
  showTopBorder,
  onPress,
}: {
  row: SurfaceRow;
  showTopBorder: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <MotionPressable
      accessibilityRole="button"
      feedback="row"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderTopWidth: showTopBorder ? 1 : 0,
        borderTopColor: tokens.color.line,
        backgroundColor: pressed ? tokens.color.tint : tokens.color.panel,
        paddingHorizontal: tokens.space.md,
        paddingVertical: tokens.space.sm,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens.radius.control,
          borderWidth: 1,
          borderColor: tokens.color.line,
          backgroundColor: tokens.color.surfaceStrong,
        }}
      >
        <AgentHubIcon color={tokens.color.accent} name={row.icon} size={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: tokens.color.ink,
              fontSize: tokens.type.sm,
              fontWeight: tokens.type.weight.medium,
              lineHeight: tokens.type.lineHeight.sm,
            }}
          >
            {row.title}
          </Text>
          <Badge label={row.meta} size="micro" />
        </View>
        <Text
          numberOfLines={2}
          style={{
            color: tokens.color.inkMuted,
            fontSize: tokens.type.xs,
            lineHeight: tokens.type.lineHeight.xs,
          }}
        >
          {row.subtitle}
        </Text>
      </View>
      {row.target || row.onPress ? (
        <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={17} />
      ) : null}
    </MotionPressable>
  );
}

function OverflowListRow({
  row,
  showTopBorder,
  onPress,
}: {
  row: SurfaceRow;
  showTopBorder: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <MotionPressable
      accessibilityRole="button"
      feedback="row"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderTopWidth: showTopBorder ? 1 : 0,
        borderTopColor: tokens.color.line,
        backgroundColor: pressed ? tokens.color.tint : tokens.color.panel,
        paddingHorizontal: tokens.space.xs,
        paddingVertical: tokens.space.xs,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AgentHubIcon color={tokens.color.accent} name={row.icon} size={19} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            color: tokens.color.ink,
            fontSize: tokens.type.sm,
            fontWeight: tokens.type.weight.medium,
            lineHeight: tokens.type.lineHeight.sm,
          }}
        >
          {row.title}
        </Text>
        <Text
          numberOfLines={2}
          style={{
            color: tokens.color.inkMuted,
            fontSize: tokens.type.xs,
            lineHeight: tokens.type.lineHeight.xs,
          }}
        >
          {row.subtitle}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: tokens.color.inkSubtle,
          fontSize: tokens.type.xs,
          lineHeight: tokens.type.lineHeight.xs,
          maxWidth: 92,
        }}
      >
        {row.meta}
      </Text>
      {row.target || row.onPress ? (
        <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={17} />
      ) : null}
    </MotionPressable>
  );
}
