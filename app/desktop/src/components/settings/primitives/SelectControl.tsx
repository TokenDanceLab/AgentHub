import { Select } from '@shared/ui';

type SelectValue = string;

interface SelectControlProps {
  value: SelectValue;
  options: Array<[SelectValue, string]>;
  onChange: (value: string) => void;
}

export default function SelectControl({ value, options, onChange }: SelectControlProps) {
  return <Select value={value} options={options} onChange={onChange} />;
}
