import { useTranslation } from 'react-i18next';
import { Code2, ShieldCheck, TerminalSquare, Globe2 } from 'lucide-react';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SummaryCard from '../primitives/SummaryCard';
import CapabilityCard from '../primitives/CapabilityCard';
import Callout from '../primitives/Callout';
import Switch from '../primitives/Switch';
import ProjectSkillCard from '../cards/ProjectSkillCard';
import styles from '../primitives/primitives.module.css';

export interface ProjectSkill {
  id: string;
  title: string;
  descriptionKey: string;
  status: 'ready' | 'review';
  hasScripts: boolean;
  hasReferences: boolean;
}

const PROJECT_SKILLS: ProjectSkill[] = [
  { id: 'adapter-dev', title: 'adapter-dev', descriptionKey: 'settings.skill.adapterDevDesc', status: 'ready', hasScripts: false, hasReferences: false },
  { id: 'dev-loop', title: 'dev-loop', descriptionKey: 'settings.skill.devLoopDesc', status: 'ready', hasScripts: false, hasReferences: true },
  { id: 'env-sandbox', title: 'env-sandbox', descriptionKey: 'settings.skill.envSandboxDesc', status: 'ready', hasScripts: false, hasReferences: false },
  { id: 'integration-test', title: 'integration-test', descriptionKey: 'settings.skill.integrationTestDesc', status: 'ready', hasScripts: false, hasReferences: false },
  { id: 'pre-push', title: 'pre-push', descriptionKey: 'settings.skill.prePushDesc', status: 'review', hasScripts: false, hasReferences: false },
  { id: 'test-coverage', title: 'test-coverage', descriptionKey: 'settings.skill.testCoverageDesc', status: 'ready', hasScripts: false, hasReferences: false },
  { id: 'ui-screenshot', title: 'ui-screenshot', descriptionKey: 'settings.skill.uiScreenshotDesc', status: 'ready', hasScripts: true, hasReferences: false },
];

interface SkillsSectionProps {
  hubSessionActive: boolean;
}

export default function SkillsSection({ hubSessionActive }: SkillsSectionProps) {
  const { t } = useTranslation();
  const skillScriptCount = PROJECT_SKILLS.filter((s) => s.hasScripts).length;
  const skillReferenceCount = PROJECT_SKILLS.filter((s) => s.hasReferences).length;
  const skillReadyCount = PROJECT_SKILLS.filter((s) => s.status === 'ready').length;

  return (
    <Panel title={t('settings.skills')} description={t('settings.skillsDesc')}>
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<Code2 size={18} />} label={t('settings.skillProjectRegistry')} value={`${PROJECT_SKILLS.length}`} detail={t('settings.skillProjectRegistryDesc')} />
        <SummaryCard icon={<ShieldCheck size={18} />} label={t('settings.skillReviewReady')} value={`${skillReadyCount}/${PROJECT_SKILLS.length}`} detail={t('settings.skillReviewReadyDesc')} />
        <SummaryCard icon={<TerminalSquare size={18} />} label={t('settings.skillScripts')} value={`${skillScriptCount}`} detail={t('settings.skillScriptsDesc')} />
        <SummaryCard icon={<Globe2 size={18} />} label={t('settings.skillHubSync')} value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} detail={hubSessionActive ? t('settings.skillHubSyncNoInterface') : t('settings.skillHubSyncSignedOut')} />
      </div>
      <SettingRow title={t('settings.skillSync')} description={t('settings.skillSyncDesc')} control={<Switch checked={false} onChange={() => {}} disabled />} />
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.skillInstalled')}</strong><span>{t('settings.skillInstalledDesc')}</span></div>
        <div className={styles.profileGrid}>{PROJECT_SKILLS.map((skill) => <ProjectSkillCard key={skill.id} skill={skill} />)}</div>
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.skillGovernance')}</strong><span>{t('settings.skillGovernanceDesc')}</span></div>
        <div className={styles.capabilityGrid}>
          <CapabilityCard title={t('settings.skillLocalRegistry')} description={t('settings.skillLocalRegistryDesc')} status=".agents/skills" />
          <CapabilityCard title={t('settings.skillReview')} description={t('settings.skillReviewDesc')} status={`${skillReadyCount}/${PROJECT_SKILLS.length}`} />
          <CapabilityCard title={t('settings.skillScriptAudit')} description={t('settings.skillScriptAuditDesc')} status={`${skillScriptCount}`} />
          <CapabilityCard title={t('settings.skillReferences')} description={t('settings.skillReferencesDesc')} status={`${skillReferenceCount}`} />
        </div>
      </div>
      <Callout title={t('settings.skillGuard')} body={t('settings.skillGuardDesc')} />
    </Panel>
  );
}
