import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Plus, Trash2, Pencil, Users, X } from 'lucide-react';
import { useAgentTeams, useCreateAgentTeam, useUpdateAgentTeam, useDeleteAgentTeam, useAddTeamMember, useRemoveTeamMember } from '@/api/teamRunQueries';
import { useAgentList } from '@/api/agentQueries';
import { useHealth } from '@/hooks/useHealth';
import type { AgentTeam, AgentTeamMember } from '@/api/hubClient';
import Panel from '../primitives/Panel';
import SummaryCard from '../primitives/SummaryCard';
import EmptyBlock from '../primitives/EmptyBlock';
import AuthGapBlock from '../primitives/AuthGapBlock';
import { useToastStore } from '@/stores/toastStore';
import sectionStyles from './AgentTeamsSection.module.css';
import pageStyles from '../../SettingsPage.module.css';

interface Props {
  hubSessionActive: boolean;
  onOpenAuth: () => void;
}

export default function AgentTeamsSection({ hubSessionActive, onOpenAuth }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { online: edgeOnline } = useHealth();
  const { data: agentData } = useAgentList(edgeOnline);
  const agents = agentData?.items ?? [];

  const { data: teams, isLoading, isFetching, isError } = useAgentTeams(hubSessionActive);
  const createTeam = useCreateAgentTeam();
  const updateTeam = useUpdateAgentTeam();
  const deleteTeam = useDeleteAgentTeam();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();

  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | 'members'; team?: AgentTeam } | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [memberProfileId, setMemberProfileId] = useState('');
  const [memberRole, setMemberRole] = useState('executor');

  const teamList = teams ?? [];
  const totalMembers = teamList.reduce((sum, t) => sum + (t.members?.length ?? 0), 0);

  function openCreate() {
    setFormName('');
    setFormDescription('');
    setModal({ type: 'create' });
  }

  function openEdit(team: AgentTeam) {
    setFormName(team.name);
    setFormDescription(team.description ?? '');
    setModal({ type: 'edit', team });
  }

  function openDelete(team: AgentTeam) {
    setModal({ type: 'delete', team });
  }

  function openMembers(team: AgentTeam) {
    setMemberProfileId('');
    setMemberRole('executor');
    setModal({ type: 'members', team });
  }

  function closeModal() {
    setModal(null);
  }

  async function handleCreate() {
    if (!formName.trim()) return;
    try {
      await createTeam.mutateAsync({ name: formName.trim(), description: formDescription.trim() || undefined });
      addToast({ type: 'success', message: t('settings.agentTeams.created') });
      closeModal();
    } catch {
      addToast({ type: 'error', message: t('settings.agentTeams.createFailed') });
    }
  }

  async function handleUpdate() {
    if (!formName.trim() || !modal?.team) return;
    try {
      await updateTeam.mutateAsync({ teamId: modal.team.id, data: { name: formName.trim(), description: formDescription.trim() || undefined } });
      addToast({ type: 'success', message: t('settings.agentTeams.updated') });
      closeModal();
    } catch {
      addToast({ type: 'error', message: t('settings.agentTeams.updateFailed') });
    }
  }

  async function handleDelete() {
    if (!modal?.team) return;
    try {
      await deleteTeam.mutateAsync(modal.team.id);
      addToast({ type: 'success', message: t('settings.agentTeams.deleted') });
      closeModal();
    } catch {
      addToast({ type: 'error', message: t('settings.agentTeams.deleteFailed') });
    }
  }

  async function handleAddMember() {
    if (!modal?.team || !memberProfileId.trim()) return;
    try {
      await addMember.mutateAsync({ teamId: modal.team.id, data: { agent_profile_id: memberProfileId.trim(), role: memberRole } });
      addToast({ type: 'success', message: t('settings.agentTeams.memberAdded') });
      setMemberProfileId('');
    } catch {
      addToast({ type: 'error', message: t('settings.agentTeams.memberAddFailed') });
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!modal?.team) return;
    try {
      await removeMember.mutateAsync({ teamId: modal.team.id, memberId });
      addToast({ type: 'success', message: t('settings.agentTeams.memberRemoved') });
    } catch {
      addToast({ type: 'error', message: t('settings.agentTeams.memberRemoveFailed') });
    }
  }

  return (
    <Panel title={t('settings.agentTeams')} description={t('settings.agentTeamsDesc')}>
      {!hubSessionActive ? (
        <AuthGapBlock title={t('settings.hubSignInRequired')} description={t('settings.agentTeamsSignedOutDesc')} actionLabel={t('settings.signIn')} onAction={onOpenAuth} />
      ) : null}

      <div className={pageStyles.summaryGrid}>
        <SummaryCard icon={<Users size={18} />} label={t('settings.agentTeamsCount')} value={isLoading ? t('settings.loading') : String(teamList.length)} detail={t('settings.agentTeamsCountDesc')} />
        <SummaryCard icon={<Bot size={18} />} label={t('settings.agentTeamsMembers')} value={isLoading ? t('settings.loading') : String(totalMembers)} detail={t('settings.agentTeamsMembersDesc')} />
      </div>

      <div className={pageStyles.taskSection}>
        <div className={pageStyles.taskSectionHeader}>
          <div className={pageStyles.taskSectionTitleRow}>
            <div>
              <strong>{t('settings.agentTeamsList')}</strong>
              <span>{t('settings.agentTeamsListDesc')}</span>
            </div>
            <div className={pageStyles.taskSectionActions}>
              <button type="button" className={pageStyles.primaryBtn} onClick={openCreate} disabled={!hubSessionActive}>
                <Plus size={15} />
                {t('settings.agentTeams.newTeam')}
              </button>
            </div>
          </div>
        </div>

        {isLoading || isFetching ? (
          <EmptyBlock title={t('settings.loading')} description={t('settings.agentTeamsLoadingDesc')} />
        ) : isError ? (
          <EmptyBlock title={t('settings.hubUnavailable')} description={t('settings.agentTeamsErrorDesc')} />
        ) : teamList.length > 0 ? (
          <div className={sectionStyles.teamList}>
            {teamList.map((team) => (
              <div key={team.id} className={sectionStyles.teamCard} onClick={() => openMembers(team)}>
                <div className={sectionStyles.teamCardIcon}>
                  <Users size={18} />
                </div>
                <div className={sectionStyles.teamCardBody}>
                  <strong>{team.name}</strong>
                  <span>{team.description || t('settings.agentTeams.noDescription')}</span>
                </div>
                <div className={sectionStyles.teamCardMeta}>
                  <span className={sectionStyles.teamCardBadge}>
                    {t('settings.memberCount', { count: team.members?.length ?? 0 })}
                  </span>
                </div>
                <div className={sectionStyles.teamCardActions}>
                  <button
                    type="button"
                    className={sectionStyles.teamCardActionBtn}
                    title={t('settings.agentTeams.edit')}
                    onClick={(e) => { e.stopPropagation(); openEdit(team); }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className={`${sectionStyles.teamCardActionBtn} ${sectionStyles.teamCardActionBtnDanger}`}
                    title={t('settings.agentTeams.delete')}
                    onClick={(e) => { e.stopPropagation(); openDelete(team); }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.agentTeams.empty')} description={hubSessionActive ? t('settings.agentTeams.emptyDesc') : t('settings.agentTeamsSignedOutDesc')} />
        )}
      </div>

      {/* ── Create / Edit modal ── */}
      {modal && (modal.type === 'create' || modal.type === 'edit') ? (
        <div className={sectionStyles.modalOverlay} onClick={closeModal}>
          <div className={sectionStyles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>{modal.type === 'create' ? t('settings.agentTeams.newTeam') : t('settings.agentTeams.edit')}</h3>
            <span className={sectionStyles.modalSubtitle}>
              {modal.type === 'create' ? t('settings.agentTeams.createSubtitle') : t('settings.agentTeams.editSubtitle')}
            </span>
            <div className={sectionStyles.formGroup}>
              <label>{t('settings.agentTeams.name')}</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('settings.agentTeams.namePlaceholder')}
                autoFocus
              />
            </div>
            <div className={sectionStyles.formGroup}>
              <label>{t('settings.agentTeams.description')}</label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder={t('settings.agentTeams.descriptionPlaceholder')}
              />
            </div>
            <div className={sectionStyles.modalActions}>
              <button type="button" className={sectionStyles.btnSecondary} onClick={closeModal}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={sectionStyles.btnPrimary}
                disabled={!formName.trim() || createTeam.isPending || updateTeam.isPending}
                onClick={modal.type === 'create' ? handleCreate : handleUpdate}
              >
                {modal.type === 'create' ? t('common.create') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Delete confirmation modal ── */}
      {modal && modal.type === 'delete' && modal.team ? (
        <div className={sectionStyles.modalOverlay} onClick={closeModal}>
          <div className={sectionStyles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>{t('settings.agentTeams.confirmDelete')}</h3>
            <p className={sectionStyles.confirmText}>
              {t('settings.agentTeams.confirmDeleteDesc', { name: modal.team.name })}
            </p>
            <div className={sectionStyles.modalActions}>
              <button type="button" className={sectionStyles.btnSecondary} onClick={closeModal}>
                {t('common.cancel')}
              </button>
              <button type="button" className={sectionStyles.btnDanger} disabled={deleteTeam.isPending} onClick={handleDelete}>
                {deleteTeam.isPending ? t('settings.agentTeams.deleting') : t('settings.agentTeams.delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Members modal ── */}
      {modal && modal.type === 'members' && modal.team ? (
        <div className={sectionStyles.modalOverlay} onClick={closeModal}>
          <div className={sectionStyles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>{modal.team.name} — {t('teamrun.members')}</h3>
            <span className={sectionStyles.modalSubtitle}>{t('settings.agentTeams.membersSubtitle')}</span>

            <div className={sectionStyles.memberList}>
              {modal.team.members && modal.team.members.length > 0 ? (
                modal.team.members.map((m: AgentTeamMember) => (
                  <div key={m.id} className={sectionStyles.memberRow}>
                    <div className={sectionStyles.memberRowInfo}>
                      <strong>{m.agent_profile_id}</strong>
                      <span>{m.role}</span>
                    </div>
                    <button
                      type="button"
                      className={sectionStyles.memberRowRemoveBtn}
                      title={t('settings.agentTeams.removeMember')}
                      onClick={() => handleRemoveMember(m.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <EmptyBlock title={t('teamrun.noMembers')} description={t('teamrun.noMembersDesc')} />
              )}
            </div>

            <span className={sectionStyles.sectionLabel}>{t('settings.agentTeams.addMember')}</span>
            <div className={sectionStyles.addMemberForm}>
              <div className={sectionStyles.formGroup}>
                <label>{t('settings.agentTeams.memberProfile')}</label>
                <select value={memberProfileId} onChange={(e) => setMemberProfileId(e.target.value)}>
                  <option value="">{t('settings.agentTeams.selectProfile')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className={sectionStyles.formGroup}>
                <label>{t('settings.agentTeams.memberRole')}</label>
                <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
                  <option value="supervisor">{t('settings.agentTeams.role.supervisor')}</option>
                  <option value="executor">{t('settings.agentTeams.role.executor')}</option>
                  <option value="reviewer">{t('settings.agentTeams.role.reviewer')}</option>
                </select>
              </div>
              <button
                type="button"
                className={sectionStyles.inlineAddBtn}
                disabled={!memberProfileId.trim() || addMember.isPending}
                onClick={handleAddMember}
              >
                <Plus size={13} />
                {t('common.add')}
              </button>
            </div>

            <div className={sectionStyles.modalActions}>
              <button type="button" className={sectionStyles.btnSecondary} onClick={closeModal}>
                {t('settings.back')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
