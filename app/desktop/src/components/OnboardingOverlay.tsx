import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '@shared/ui/focusTrap';
import styles from './OnboardingOverlay.module.css';

interface OnboardingStepDescriptor {
  titleKey: string;
  bodyKey: string;
}

const ONBOARDING_STEPS: OnboardingStepDescriptor[] = [
  { titleKey: 'onboarding.step1.title', bodyKey: 'onboarding.step1.body' },
  { titleKey: 'onboarding.step2.title', bodyKey: 'onboarding.step2.body' },
];

export interface OnboardingOverlayProps {
  /** Called once when the user finishes the last step or skips. */
  onFinish: () => void;
}

/**
 * First-run guidance overlay (#1819). Shown until the desktop shell marks
 * onboarding seen (localStorage `agenthub_onboarding_seen` via hubStore);
 * Escape or Skip dismisses it immediately, Next/Get started walk the steps.
 */
export function OnboardingOverlay({ onFinish }: OnboardingOverlayProps): React.ReactElement {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const clampedStepIndex = Math.min(stepIndex, ONBOARDING_STEPS.length - 1);
  const step = ONBOARDING_STEPS[clampedStepIndex] ?? {
    titleKey: 'onboarding.step1.title',
    bodyKey: 'onboarding.step1.body',
  };
  const isLastStep = clampedStepIndex >= ONBOARDING_STEPS.length - 1;

  // Modal focus contract (#1856 CodeRabbit): the shared trap moves focus into
  // the dialog, cycles Tab/Shift+Tab inside, and returns focus to the trigger
  // on unmount. Escape stays a local handler because it finishes onboarding.
  useFocusTrap(dialogRef, true);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onFinish();
      }
    },
    [onFinish],
  );

  return (
    <div className={styles.backdrop} data-testid="onboarding-overlay" onKeyDown={handleKeyDown}>
      <div
        aria-label={t('onboarding.title')}
        aria-modal="true"
        className={styles.dialog}
        data-testid="onboarding-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <p className={styles.eyebrow}>{t('onboarding.title')}</p>
        <h2 className={styles.title}>{t(step.titleKey)}</h2>
        <p className={styles.body}>{t(step.bodyKey)}</p>
        <ol aria-label={t('onboarding.progress')} className={styles.progress}>
          {ONBOARDING_STEPS.map((descriptor, index) => (
            <li
              aria-current={index === stepIndex ? 'step' : undefined}
              className={index === stepIndex ? styles.dotActive : styles.dot}
              data-testid={`onboarding-dot-${index}`}
              key={descriptor.titleKey}
            />
          ))}
        </ol>
        <div className={styles.actions}>
          <button
            className={styles.secondaryButton}
            data-testid="onboarding-skip"
            onClick={onFinish}
            type="button"
          >
            {t('onboarding.skip')}
          </button>
          {isLastStep ? (
            <button
              className={styles.primaryButton}
              data-testid="onboarding-done"
              onClick={onFinish}
              type="button"
            >
              {t('onboarding.done')}
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              data-testid="onboarding-next"
              onClick={() =>
                setStepIndex((index) => Math.min(index + 1, ONBOARDING_STEPS.length - 1))
              }
              type="button"
            >
              {t('onboarding.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
