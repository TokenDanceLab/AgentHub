import { useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Send, Globe2, ShieldCheck, Package, FileText, Wrench, Tag,
  Cpu, Eye, Check, AlertTriangle, Loader2, Star, Users,
} from 'lucide-react';
import styles from '../../SettingsPage.module.css';

export interface PublishAgentPayload {
  id: string;
  name: string;
  description: string;
  agentType: string;
  systemPrompt: string;
  capabilities: string[];
  tools: string[];
  model: string;
  provider: string;
  version?: string;
}

export interface PublishAgentMeta {
  version: string;
  releaseNotes: string;
  category: string;
  visibility: 'public' | 'private';
  tags: string[];
}

interface PreflightCheck {
  label: string;
  passed: boolean;
  detail: string;
}

interface PublishAgentModalProps {
  agent: PublishAgentPayload;
  onClose: () => void;
  onPublished: (agentId: string) => void;
}

const CATEGORY_OPTIONS = [
  { value: 'assistant', label: 'settings.agentCreator.typeAssistant' },
  { value: 'coder', label: 'settings.agentCreator.typeCoder' },
  { value: 'reviewer', label: 'settings.agentCreator.typeReviewer' },
  { value: 'researcher', label: 'settings.agentCreator.typeResearcher' },
  { value: 'custom', label: 'settings.agentCreator.typeCustom' },
];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'settings.marketPublish.visibilityPublic' },
  { value: 'private', label: 'settings.marketPublish.visibilityPrivate' },
];

function runPreflightChecks(agent: PublishAgentPayload): PreflightCheck[] {
  return [
    {
      label: 'settings.marketPublish.checkName',
      passed: agent.name.trim().length >= 3,
      detail: agent.name.trim().length >= 3 ? 'passed' : 'tooShort',
    },
    {
      label: 'settings.marketPublish.checkPrompt',
      passed: agent.systemPrompt.trim().length >= 20,
      detail: agent.systemPrompt.trim().length >= 20 ? 'passed' : 'tooShort',
    },
    {
      label: 'settings.marketPublish.checkDescription',
      passed: agent.description.trim().length >= 10,
      detail: agent.description.trim().length >= 10 ? 'passed' : 'tooShort',
    },
    {
      label: 'settings.marketPublish.checkTools',
      passed: agent.tools.length > 0,
      detail: agent.tools.length > 0 ? 'passed' : 'noTools',
    },
    {
      label: 'settings.marketPublish.checkCapabilities',
      passed: agent.capabilities.length > 0,
      detail: agent.capabilities.length > 0 ? 'passed' : 'noCapabilities',
    },
  ];
}

export default function PublishAgentModal({
  agent,
  onClose,
  onPublished,
}: PublishAgentModalProps) {
  const { t } = useTranslation();

  const [meta, setMeta] = useState<PublishAgentMeta>(() => ({
    version: agent.version ?? '1.0.0',
    releaseNotes: '',
    category: agent.agentType,
    visibility: 'public',
    tags: [...agent.capabilities],
  }));

  const [step, setStep] = useState<'preview' | 'metadata' | 'review' | 'submitting' | 'done'>('preview');
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const checks = useMemo(() => runPreflightChecks(agent), [agent]);
  const allChecksPassed = checks.every((c) => c.passed);

  const updateMeta = useCallback(<K extends keyof PublishAgentMeta>(key: K, value: PublishAgentMeta[K]) => {
    setMeta((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setMeta((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
    }));
  }, []);

  const handleSubmit = useCallback(() => {
    setStep('submitting');
    setSubmissionError(null);

    // Mock Hub API submission
    setTimeout(() => {
      try {
        // Persist publish submission record locally
        const published = JSON.parse(localStorage.getItem('agenthub-settings.publishedAgents') ?? '[]') as unknown[];
        const arr = Array.isArray(published) ? published as Record<string, unknown>[] : [];
        arr.push({
          agentId: agent.id,
          name: agent.name,
          version: meta.version,
          category: meta.category,
          visibility: meta.visibility,
          tags: meta.tags,
          releaseNotes: meta.releaseNotes,
          submittedAt: new Date().toISOString(),
          status: 'pending_review',
          reviewId: `review-${Date.now().toString(36)}`,
        });
        localStorage.setItem('agenthub-settings.publishedAgents', JSON.stringify(arr));

        setStep('done');
        onPublished(agent.id);
      } catch (err) {
        setSubmissionError(err instanceof Error ? err.message : String(err));
        setStep('metadata');
      }
    }, 1800);
  }, [agent, meta, onPublished]);

  const handleClose = useCallback(() => {
    if (step !== 'submitting') {
      onClose();
    }
  }, [step, onClose]);

  return (
    <div className={styles.creatorOverlay} onClick={handleClose}>
      <div className={`${styles.creatorDialog} ${styles.publishModal}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.creatorHeader}>
          <div className={styles.creatorHeaderLeft}>
            <div className={styles.profileIcon}>
              <Globe2 size={17} />
            </div>
            <div>
              <h2>{t('settings.marketPublish.title')}</h2>
              <span>{t('settings.marketPublish.subtitle', { name: agent.name })}</span>
            </div>
          </div>
          {step !== 'submitting' && (
            <button type="button" className={styles.creatorCloseBtn} onClick={onClose} aria-label={t('settings.agentCreator.close')}>
              <X size={18} />
            </button>
          )}
        </div>

        {/* Step indicator */}
        {step !== 'done' && step !== 'submitting' && (
          <div className={styles.wizardProgressBar} style={{ padding: '0 24px', marginTop: 8 }}>
            {(['preview', 'metadata', 'review'] as const).map((s, idx, arr) => {
              const stepIdx = arr.indexOf(step);
              const current = s === step;
              const completed = stepIdx > arr.indexOf(s);
              const label = t(`settings.marketPublish.step${idx + 1}`);
              const cls = current
                ? styles.wizardStepActive
                : completed
                  ? styles.wizardStepCompleted
                  : '';
              return (
                <div key={s} className={styles.wizardStep + (cls ? ` ${cls}` : '')} onClick={() => {
                  if (completed || stepIdx >= arr.indexOf(s)) setStep(s);
                }}>
                  <div className={styles.wizardStepIndicator}>
                    {completed ? <Check size={12} /> : idx + 1}
                  </div>
                  <span className={styles.wizardStepLabel}>{label}</span>
                  {idx < 2 && (
                    <div className={`${styles.wizardStepConnector} ${completed ? styles.wizardStepConnectorCompleted : ''}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div className={styles.creatorBody}>
          {/* Submitting state */}
          {step === 'submitting' && (
            <div className={styles.publishSubmitting}>
              <Loader2 size={32} className={styles.publishSpinner} />
              <strong>{t('settings.marketPublish.submitting')}</strong>
              <span>{t('settings.marketPublish.submittingDesc')}</span>
            </div>
          )}

          {/* Done state */}
          {step === 'done' && (
            <div className={styles.publishSubmitting}>
              <div className={styles.publishSuccessIcon}>
                <Check size={28} />
              </div>
              <strong>{t('settings.marketPublish.doneTitle')}</strong>
              <span>{t('settings.marketPublish.doneDesc', { name: agent.name })}</span>
              <div className={styles.publishReviewBadge}>
                <ShieldCheck size={14} />
                {t('settings.marketPublish.reviewPending')}
              </div>
              <button type="button" className={styles.primaryBtn} onClick={onClose}>
                <Check size={14} />
                {t('settings.marketPublish.doneBtn')}
              </button>
            </div>
          )}

          {/* --- Step 1: Preview --- */}
          {step === 'preview' && (
            <div className={styles.creatorSection}>
              <p className={styles.creatorSectionDesc}>{t('settings.marketPublish.previewDesc')}</p>

              <div className={styles.publishPreviewCard}>
                <div className={styles.marketAgentCardHeader}>
                  <div className={styles.marketAgentIcon}>
                    <Package size={20} />
                  </div>
                  <div className={styles.marketAgentTitle}>
                    <strong>{agent.name}</strong>
                    <span>{agent.agentType}</span>
                  </div>
                </div>
                {agent.description && (
                  <p className={styles.marketAgentDesc}>{agent.description}</p>
                )}
                <div className={styles.marketAgentTags}>
                  {agent.capabilities.slice(0, 4).map((cap) => (
                    <span key={cap} className={styles.marketAgentCapTag}>
                      <Tag size={10} />{cap}
                    </span>
                  ))}
                  {agent.capabilities.length > 4 && (
                    <span className={styles.marketAgentCapTag}>+{agent.capabilities.length - 4}</span>
                  )}
                </div>
                <div className={styles.marketAgentMeta}>
                  <span><Cpu size={11} />{agent.model}</span>
                  <span><Wrench size={11} />{agent.tools.length} tools</span>
                </div>
              </div>

              <div className={styles.marketDetailSection} style={{ marginTop: 16 }}>
                <strong>{t('settings.agentCreator.promptTemplate')}</strong>
                <pre className={styles.marketDetailPrompt}>{agent.systemPrompt.slice(0, 400)}{agent.systemPrompt.length > 400 ? '...' : ''}</pre>
              </div>
            </div>
          )}

          {/* --- Step 2: Metadata --- */}
          {step === 'metadata' && (
            <div className={styles.creatorSection}>
              <div className={styles.creatorField}>
                <label>{t('settings.marketPublish.version')}</label>
                <input
                  type="text"
                  className={styles.creatorInput}
                  value={meta.version}
                  onChange={(e) => updateMeta('version', e.target.value)}
                  placeholder="1.0.0"
                />
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.marketPublish.releaseNotes')}</label>
                <textarea
                  className={styles.creatorTextarea}
                  value={meta.releaseNotes}
                  onChange={(e) => updateMeta('releaseNotes', e.target.value)}
                  placeholder={t('settings.marketPublish.releaseNotesPlaceholder')}
                  rows={4}
                />
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.marketPublish.category')}</label>
                <select
                  className={styles.creatorSelect}
                  value={meta.category}
                  onChange={(e) => updateMeta('category', e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{t(c.label)}</option>
                  ))}
                </select>
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.marketPublish.visibility')}</label>
                <div className={styles.creatorReasoningGrid}>
                  {VISIBILITY_OPTIONS.map((v) => (
                    <label
                      key={v.value}
                      className={`${styles.creatorReasoningCard} ${meta.visibility === v.value ? styles.creatorReasoningCardActive : ''}`}
                    >
                      <input
                        type="radio"
                        name="visibility"
                        value={v.value}
                        checked={meta.visibility === v.value}
                        onChange={(e) => updateMeta('visibility', e.target.value as 'public' | 'private')}
                      />
                      <span>{t(v.label)}</span>
                    </label>
                  ))}
                </div>
                <span className={styles.creatorFieldHint}>
                  {meta.visibility === 'public'
                    ? t('settings.marketPublish.visibilityPublicHint')
                    : t('settings.marketPublish.visibilityPrivateHint')}
                </span>
              </div>

              <div className={styles.creatorField}>
                <label>{t('settings.marketPublish.tags')}</label>
                <div className={styles.marketTagFilterPanel} style={{ marginTop: 4, padding: 8 }}>
                  {agent.capabilities.length > 0 ? (
                    agent.capabilities.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`${styles.marketTagChip} ${meta.tags.includes(tag) ? styles.marketTagChipSelected : ''}`}
                        onClick={() => toggleTag(tag)}
                      >
                        <Tag size={11} />{tag}
                      </button>
                    ))
                  ) : (
                    <span className={styles.creatorFieldHint}>{t('settings.marketPublish.noTagsAvailable')}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* --- Step 3: Review & Preflight --- */}
          {step === 'review' && (
            <div className={styles.creatorSection}>
              <p className={styles.creatorSectionDesc}>{t('settings.marketPublish.reviewDesc')}</p>

              <div className={styles.publishReviewGrid}>
                {checks.map((check) => (
                  <div key={check.label} className={`${styles.publishCheckCard} ${check.passed ? styles.publishCheckPassed : styles.publishCheckFailed}`}>
                    <div className={styles.publishCheckIcon}>
                      {check.passed ? <Check size={14} /> : <AlertTriangle size={14} />}
                    </div>
                    <div>
                      <strong>{t(check.label)}</strong>
                      <span>{t(`settings.marketPublish.checkResult.${check.detail}`)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {!allChecksPassed && (
                <div className={styles.publishWarning}>
                  <AlertTriangle size={16} />
                  <span>{t('settings.marketPublish.reviewWarn')}</span>
                </div>
              )}

              {/* Final review summary */}
              <div className={styles.publishReviewSummary}>
                <div className={styles.publishReviewRow}>
                  <FileText size={14} />
                  <span>{t('settings.marketPublish.reviewFileName')}: <strong>{agent.name} (v{meta.version})</strong></span>
                </div>
                <div className={styles.publishReviewRow}>
                  <Tag size={14} />
                  <span>{t('settings.marketPublish.reviewCategory')}: <strong>{t(`settings.agentCreator.type${meta.category.charAt(0).toUpperCase()}${meta.category.slice(1)}`, { defaultValue: meta.category })}</strong></span>
                </div>
                <div className={styles.publishReviewRow}>
                  <Eye size={14} />
                  <span>{t('settings.marketPublish.reviewVisibility')}: <strong>{t(`settings.marketPublish.visibility${meta.visibility.charAt(0).toUpperCase()}${meta.visibility.slice(1)}`)}</strong></span>
                </div>
                {meta.releaseNotes && (
                  <div className={styles.publishReviewRow}>
                    <FileText size={14} />
                    <span>{t('settings.marketPublish.reviewNotes')}: <em>{meta.releaseNotes.slice(0, 120)}{meta.releaseNotes.length > 120 ? '...' : ''}</em></span>
                  </div>
                )}
                {meta.tags.length > 0 && (
                  <div className={styles.publishReviewRow}>
                    <Tag size={14} />
                    <div className={styles.marketDetailTags} style={{ marginLeft: 4 }}>
                      {meta.tags.slice(0, 5).map((tag) => (
                        <span key={tag} className={styles.marketDetailChip}><Tag size={9} />{tag}</span>
                      ))}
                      {meta.tags.length > 5 && <span>+{meta.tags.length - 5}</span>}
                    </div>
                  </div>
                )}
              </div>

              {submissionError && (
                <div className={styles.publishError}>
                  <AlertTriangle size={16} />
                  <span>{submissionError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'done' && step !== 'submitting' && (
          <div className={styles.creatorFooter}>
            <div>
              <button type="button" className={styles.secondaryBtn} onClick={onClose}>
                {t('settings.agentCreator.cancel')}
              </button>
            </div>
            <div className={styles.creatorFooterRight}>
              {step === 'preview' && (
                <button type="button" className={styles.primaryBtn} onClick={() => setStep('metadata')}>
                  {t('settings.marketPublish.nextMetadata')}
                </button>
              )}
              {step === 'metadata' && (
                <>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setStep('preview')}>
                    {t('settings.wizard.back')}
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={() => setStep('review')}>
                    {t('settings.marketPublish.nextReview')}
                  </button>
                </>
              )}
              {step === 'review' && (
                <>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setStep('metadata')}>
                    {t('settings.wizard.back')}
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handleSubmit}
                  >
                    <Send size={14} />
                    {t('settings.marketPublish.submitBtn')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
