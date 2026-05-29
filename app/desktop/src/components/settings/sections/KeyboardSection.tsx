import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import { KEYBOARD_SHORTCUT_GROUPS } from '@/utils/keyboardShortcuts';
import styles from '../../SettingsPage.module.css';

export default function KeyboardSection() {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.keyboard')} description={t('settings.keyboardDesc')}>
      <div className={styles.shortcutTable}>
        {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
          <div key={group.id} className={styles.shortcutGroup}>
            <div className={styles.shortcutGroupTitle}>{t(group.labelKey)}</div>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.id} className={styles.shortcutRow}>
                <span>{t(shortcut.labelKey)}</span>
                <div>
                  {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
