import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import Callout from '../primitives/Callout';
import { writeStoredValue } from '../utils';

interface ComputerUseSectionProps {
  computerConfirm: boolean;
  setComputerConfirm: (value: boolean) => void;
}

export default function ComputerUseSection({ computerConfirm, setComputerConfirm }: ComputerUseSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.computerUse')} description={t('settings.computerUseDesc')}>
      <SettingRow
        title={t('settings.computerConfirm')}
        description={t('settings.computerConfirmDesc')}
        control={<Switch checked={computerConfirm} onChange={(v) => { setComputerConfirm(v); writeStoredValue('computerConfirm', v); }} />}
      />
      <Callout title={t('settings.computerUseGuard')} body={t('settings.computerUseGuardDesc')} />
    </Panel>
  );
}
