import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import {
  getResolvedShortcutGroups,
  saveCustomKeybindings,
  resetKeybindings,
  hasCustomKeybindings,
  type CustomKeybinding,
  checkConflicts,
  deriveKeysFromEvent,
  type KeyboardShortcut,
} from '@/utils/keyboardShortcuts';
import styles from '../../SettingsPage.module.css';

export default function KeyboardSection() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [groups, setGroups] = useState(() => getResolvedShortcutGroups());
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState<KeyboardShortcut | null>(null);
  const [dirty, setDirty] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  // Re-sync groups when entering edit mode (picks up latest localStorage)
  useEffect(() => {
    if (editing) {
      setGroups(getResolvedShortcutGroups());
      setDirty(hasCustomKeybindings());
    }
  }, [editing]);

  // Global keydown listener for capture mode
  useEffect(() => {
    if (!capturingId) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setCapturingId(null);
        setPendingKeys(null);
        setConflict(null);
        return;
      }

      const derived = deriveKeysFromEvent(e);
      if (!derived) return;

      setPendingKeys(derived);
      setConflict(checkConflicts(derived, capturingId));
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturingId]);

  // Focus the capture element when entering capture mode
  useEffect(() => {
    if (capturingId && captureRef.current) {
      captureRef.current.focus();
    }
  }, [capturingId]);

  const startCapture = useCallback((shortcutId: string) => {
    setCapturingId(shortcutId);
    setPendingKeys(null);
    setConflict(null);
  }, []);

  const confirmCapture = useCallback(() => {
    if (!capturingId || !pendingKeys) return;

    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        shortcuts: g.shortcuts.map((s) =>
          s.id === capturingId ? { ...s, keys: pendingKeys } : s,
        ),
      })),
    );
    setDirty(true);
    setCapturingId(null);
    setPendingKeys(null);
    setConflict(null);
  }, [capturingId, pendingKeys]);

  const handleSave = useCallback(() => {
    const bindings: CustomKeybinding[] = [];
    for (const g of groups) {
      for (const s of g.shortcuts) {
        bindings.push({ id: s.id, keys: s.keys });
      }
    }
    saveCustomKeybindings(bindings);
    setEditing(false);
    setDirty(false);
  }, [groups]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setCapturingId(null);
    setPendingKeys(null);
    setConflict(null);
    setGroups(getResolvedShortcutGroups());
    setDirty(false);
  }, []);

  const handleReset = useCallback(() => {
    resetKeybindings();
    setGroups(getResolvedShortcutGroups());
    setCapturingId(null);
    setPendingKeys(null);
    setConflict(null);
    setDirty(false);
  }, []);

  const hasCustom = hasCustomKeybindings();

  return (
    <Panel title={t('settings.keyboard')} description={t('settings.keyboardDesc')}>
      {!editing ? (
        <>
          <div className={styles.shortcutTable}>
            {groups.map((group) => (
              <div key={group.id} className={styles.shortcutGroup}>
                <div className={styles.shortcutGroupTitle}>{t(group.labelKey)}</div>
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.id} className={styles.shortcutRow}>
                    <span>{t(shortcut.labelKey)}</span>
                    <div>
                      {shortcut.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className={styles.shortcutActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setEditing(true)}
            >
              {t('settings.keyboardCustomize')}
            </button>
            {hasCustom && (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={handleReset}
              >
                <RotateCcw size={14} />
                {t('settings.keyboardReset')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className={styles.shortcutEditTable}>
            {groups.map((group) => (
              <div key={group.id} className={styles.shortcutEditGroup}>
                <div className={styles.shortcutEditGroupTitle}>{t(group.labelKey)}</div>
                {group.shortcuts.map((shortcut) => {
                  const isCapturing = capturingId === shortcut.id;
                  const showConflict = isCapturing && conflict;
                  const showPending = isCapturing && pendingKeys;

                  return (
                    <div
                      key={shortcut.id}
                      className={`${styles.shortcutEditRow} ${isCapturing ? styles.shortcutEditRowCapturing : ''}`}
                    >
                      <div className={styles.shortcutEditInfo}>
                        <span className={styles.shortcutEditLabel}>{t(shortcut.labelKey)}</span>
                        {shortcut.detailKey && (
                          <span className={styles.shortcutEditDetail}>{t(shortcut.detailKey)}</span>
                        )}
                      </div>

                      <div className={styles.shortcutEditBinding}>
                        {isCapturing ? (
                          <div className={styles.shortcutCaptureArea} ref={captureRef} tabIndex={0}>
                            {showPending ? (
                              <div className={styles.shortcutCaptureKeys}>
                                {pendingKeys.map((k) => (
                                  <kbd key={k}>{k}</kbd>
                                ))}
                              </div>
                            ) : (
                              <span className={styles.shortcutCaptureHint}>
                                {t('settings.keyboardCapturePrompt')}
                              </span>
                            )}
                            {showConflict && (
                              <span className={styles.shortcutConflict}>
                                {t('settings.keyboardConflict', { action: t(conflict.labelKey) })}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className={styles.shortcutDisplayKeys}>
                            {shortcut.keys.map((k) => (
                              <kbd key={k}>{k}</kbd>
                            ))}
                          </div>
                        )}

                        <div className={styles.shortcutEditActions}>
                          {isCapturing ? (
                            <>
                              <button
                                type="button"
                                className={styles.shortcutConfirmBtn}
                                onClick={confirmCapture}
                                disabled={!pendingKeys || !!conflict}
                                aria-label={t('settings.keyboardConfirm')}
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                className={styles.shortcutCancelBtn}
                                onClick={() => {
                                  setCapturingId(null);
                                  setPendingKeys(null);
                                  setConflict(null);
                                }}
                                aria-label={t('settings.keyboardCancelCapture')}
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className={styles.shortcutEditBtn}
                              onClick={() => startCapture(shortcut.id)}
                              aria-label={t('settings.keyboardEditBinding', { action: t(shortcut.labelKey) })}
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className={styles.shortcutEditFooter}>
            <div className={styles.shortcutEditFooterActions}>
              <button type="button" className={styles.primaryBtn} onClick={handleSave} disabled={!dirty}>
                {t('settings.keyboardSave')}
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={handleCancel}>
                {t('settings.keyboardCancel')}
              </button>
            </div>
            <button type="button" className={styles.secondaryBtn} onClick={handleReset}>
              <RotateCcw size={14} />
              {t('settings.keyboardReset')}
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
