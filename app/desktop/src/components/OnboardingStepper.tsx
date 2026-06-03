import { memo } from 'react';
import { Check } from 'lucide-react';
import styles from './OnboardingStepper.module.css';

export interface Step {
  label: string;
}

interface Props {
  steps: Step[];
  currentStep: number; // 0-indexed
}

export default memo(function OnboardingStepper({ steps, currentStep }: Props) {
  return (
    <nav className={styles.stepper} aria-label="Onboarding progress">
      <ol className={styles.list}>
        {steps.map((step, idx) => {
          const isCompleted = idx < currentStep;
          const isActive = idx === currentStep;
          const isPending = idx > currentStep;

          let stateClass = styles.stepPending;
          if (isCompleted) stateClass = styles.stepCompleted;
          else if (isActive) stateClass = styles.stepActive;

          return (
            <li key={idx} className={`${styles.item} ${stateClass}`}>
              {idx > 0 && (
                <div
                  className={`${styles.connector} ${isCompleted || isActive ? styles.connectorFilled : ''}`}
                  aria-hidden="true"
                />
              )}
              <div className={styles.indicator}>
                {isCompleted ? (
                  <span className={styles.checkIcon}>
                    <Check size={14} strokeWidth={3} />
                  </span>
                ) : (
                  <span className={styles.stepNumber}>{idx + 1}</span>
                )}
              </div>
              <span
                className={`${styles.label} ${isActive ? styles.labelActive : ''} ${isPending ? styles.labelPending : ''}`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
});
