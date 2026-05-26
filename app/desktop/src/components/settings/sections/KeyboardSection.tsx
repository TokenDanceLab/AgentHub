import { useTranslation } from 'react-i18next';
import { Keyboard } from 'lucide-react';
import Panel from '../primitives/Panel';
import styles from '../../SettingsPage.module.css';

const shortcuts = [
  { keys: ['Enter'], actionKey: 'shortcut.send' },
  { keys: ['Shift', 'Enter'], actionKey: 'shortcut.newline' },
  { keys: ['Ctrl', 'K'], actionKey: 'shortcut.search' },
  { keys: ['⌘/Ctrl', 'B'], actionKey: 'shortcut.toggleSidebar' },
  { keys: ['⌘/Ctrl', 'J'], actionKey: 'shortcut.toggleRunPanel' },
  { keys: ['Esc'], actionKey: 'shortcut.close' },
  { keys: ['?'], actionKey: 'shortcut.help' },
];

export default function KeyboardSection() {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.keyboard')} description={t('settings.keyboardDesc')}>
      <div className={styles.shortcutTable}>
        {shortcuts.map((shortcut) => (
          <div key={`${shortcut.keys.join('+')}-${shortcut.actionKey}`} className={styles.shortcutRow}>
            <span>{t(shortcut.actionKey)}</span>
            <div>
              {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
