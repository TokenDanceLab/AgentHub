import styles from '../../SettingsPage.module.css';

type SelectValue = string;

interface SelectControlProps {
  value: SelectValue;
  options: Array<[SelectValue, string]>;
  onChange: (value: string) => void;
}

export default function SelectControl({ value, options, onChange }: SelectControlProps) {
  return (
    <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}
