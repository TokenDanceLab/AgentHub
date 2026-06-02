import styles from '../../SettingsPage.module.css';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export default function Switch({ checked, onChange, disabled = false }: SwitchProps) {
  return (
    <button
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
