import { useMemo, useState, useRef, useCallback } from 'react';
import {
  Check,
  Download,
  HardDrive,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Callout from '../primitives/Callout';
import EmptyBlock from '../primitives/EmptyBlock';

interface DataSectionProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  addToast: (input: { type: 'success' | 'warning' | 'error' | 'info'; message: string }) => string;
  resetModelSettings: () => void;
}

export default function DataSection({ t, addToast, resetModelSettings }: DataSectionProps) {
  const [importConfirm, setImportConfirm] = useState<{ keyCount: number; data: Record<string, string> } | null>(null);
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const CACHE_KEY_PATTERNS = [
    'draft_',
    'agenthub:offline_queue',
    'agenthub-thread-selection',
    'agenthub-ui-shell',
    'agenthub.prompt.',
    'agenthub-settings.customAgentDrafts',
    'agenthub-custom-agent-drafts',
  ];

  function scanKeys(): Array<{ key: string; value: string; size: number; isCache: boolean }> {
    const results: Array<{ key: string; value: string; size: number; isCache: boolean }> = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const lower = key.toLowerCase();
        if (!lower.startsWith('agenthub') && !lower.startsWith('draft_')) continue;
        const value = localStorage.getItem(key) ?? '';
        const size = new Blob([key, value]).size;
        const isCache = CACHE_KEY_PATTERNS.some((p) => lower.startsWith(p));
        results.push({ key, value, size, isCache });
      }
    } catch {
      /* localStorage unavailable */
    }
    return results.sort((a, b) => b.size - a.size);
  }

  const agenthubKeys = useMemo(() => scanKeys(), []);
  const cacheKeys = useMemo(() => agenthubKeys.filter((k) => k.isCache), [agenthubKeys]);
  const totalSize = useMemo(() => agenthubKeys.reduce((sum, k) => sum + k.size, 0), [agenthubKeys]);
  const cacheSize = useMemo(() => cacheKeys.reduce((sum, k) => sum + k.size, 0), [cacheKeys]);

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function keyCategoryLabel(key: string): string {
    const lower = key.toLowerCase();
    if (lower.startsWith('agenthub-settings.')) return 'Settings';
    if (lower.startsWith('agenthub-model-settings')) return 'Model Settings';
    if (lower.startsWith('agenthub-theme') || lower.startsWith('agenthub-lang')) return 'Appearance';
    if (lower.startsWith('agenthub_hub_') || lower.includes(':edge_auth')) return 'Auth';
    if (lower.startsWith('agenthub_device_id')) return 'Device';
    if (lower.startsWith('agenthub_edge_url') || lower.startsWith('agenthub_hub_url')) return 'Config';
    if (lower.startsWith('agenthub-keybindings')) return 'Shortcuts';
    if (lower.includes('customagent') || lower.includes('installedagent')) return 'Agents';
    if (lower.startsWith('agenthub.workspace')) return 'Workspace';
    if (lower.startsWith('draft_')) return 'Draft';
    if (lower.startsWith('agenthub:offline_queue')) return 'Offline Queue';
    if (lower.startsWith('agenthub-thread-selection')) return 'Thread State';
    if (lower.startsWith('agenthub-ui-shell')) return 'UI State';
    if (lower.startsWith('agenthub.prompt.')) return 'Prompt Cache';
    return 'Other';
  }

  const handleExport = useCallback(() => {
    try {
      const data: Record<string, string> = {};
      for (const item of agenthubKeys) data[item.key] = item.value;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agenthub-settings-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      addToast({ type: 'success', message: t('settings.dataExportSuccess') });
    } catch {
      addToast({ type: 'error', message: t('settings.dataExportError') });
    }
  }, [agenthubKeys, addToast, t]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
        const data: Record<string, string> = {};
        let count = 0;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v !== 'string') continue;
          const lower = k.toLowerCase();
          if (!lower.startsWith('agenthub') && !lower.startsWith('draft_')) continue;
          data[k] = v;
          count++;
        }
        if (count === 0) {
          addToast({ type: 'warning', message: t('settings.dataImportNoKeys') });
          return;
        }
        setImportConfirm({ keyCount: count, data });
      } catch {
        addToast({ type: 'error', message: t('settings.dataImportInvalid') });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [addToast, t]);

  const handleImportConfirm = useCallback(() => {
    if (!importConfirm) return;
    try {
      for (const [k, v] of Object.entries(importConfirm.data)) localStorage.setItem(k, v);
      addToast({ type: 'success', message: t('settings.dataImportSuccess') });
    } catch {
      addToast({ type: 'error', message: t('settings.dataImportError') });
    }
    setImportConfirm(null);
  }, [importConfirm, addToast, t]);

  const handleClearCache = useCallback(() => {
    try {
      for (const item of cacheKeys) localStorage.removeItem(item.key);
      addToast({ type: 'success', message: t('settings.dataClearCacheSuccess') });
    } catch {
      addToast({ type: 'error', message: t('settings.dataClearCacheError') });
    }
    setShowClearCacheConfirm(false);
  }, [cacheKeys, addToast, t]);

  const handleResetAll = useCallback(() => {
    try {
      resetModelSettings();
      for (const item of agenthubKeys) localStorage.removeItem(item.key);
      try {
        const drafts: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.toLowerCase().startsWith('draft_')) drafts.push(k);
        }
        for (const k of drafts) localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
      addToast({ type: 'success', message: t('settings.dataResetAllSuccess') });
      setTimeout(() => window.location.reload(), 1000);
    } catch {
      addToast({ type: 'error', message: t('settings.dataResetAllError') });
      setShowResetConfirm(false);
    }
  }, [agenthubKeys, resetModelSettings, addToast, t]);

  const panelStyle: React.CSSProperties = {
    background: 'var(--settings-glass-bg)',
    borderRadius: 14,
    padding: 16,
    border: '1px solid var(--settings-glass-border)',
  };
  const mutedStyle: React.CSSProperties = { fontSize: 13, color: 'var(--settings-muted)' };

  return (
    <Panel title={t('settings.data')} description={t('settings.dataDesc')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <HardDrive size={18} />
            <span style={mutedStyle}>{t('settings.dataTotalKeys')}</span>
          </div>
          <strong style={{ fontSize: 24, fontWeight: 600 }}>{agenthubKeys.length}</strong>
          <small style={{ display: 'block', fontSize: 12, color: 'var(--settings-muted)', marginTop: 2 }}>
            {agenthubKeys.filter((k) => !k.isCache).length} {t('settings.dataSettingsKeys') ?? 'settings'}
          </small>
        </div>
        <div style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <HardDrive size={18} />
            <span style={mutedStyle}>{t('settings.dataTotalSize')}</span>
          </div>
          <strong style={{ fontSize: 24, fontWeight: 600 }}>{formatBytes(totalSize)}</strong>
          <small style={{ display: 'block', fontSize: 12, color: 'var(--settings-muted)', marginTop: 2 }}>
            {t('settings.dataCacheKeys')}: {formatBytes(cacheSize)}
          </small>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
        <SettingRow
          title={t('settings.dataExport')}
          description={t('settings.dataExportDesc')}
          control={
            <button type="button" className="primaryBtn" onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--settings-accent)', color: 'var(--settings-btn-primary-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Download size={15} />
              <span>{t('settings.dataExportAction')}</span>
            </button>
          }
        />
        <SettingRow
          title={t('settings.dataImport')}
          description={t('settings.dataImportDesc')}
          control={
            <>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
              <button type="button" className="secondaryBtn" onClick={() => fileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: '1px solid var(--settings-glass-border)', background: 'var(--settings-glass-bg)', color: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <Upload size={15} />
                <span>{t('settings.dataImportAction')}</span>
              </button>
            </>
          }
        />
        {importConfirm && (
          <div style={{ background: 'var(--settings-glass-bg)', border: '1px solid var(--settings-glass-border)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <strong style={{ display: 'block', fontSize: 14 }}>{t('settings.dataImportConfirmTitle')}</strong>
              <span style={mutedStyle}>{t('settings.dataImportConfirmDesc', { count: importConfirm.keyCount })}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="secondaryBtn" onClick={() => setImportConfirm(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--settings-glass-border)', background: 'var(--settings-glass-bg)', color: 'inherit', fontSize: 13, cursor: 'pointer' }}>
                <XCircle size={15} />
                <span>{t('settings.keyboardCancel')}</span>
              </button>
              <button type="button" className="primaryBtn" onClick={handleImportConfirm} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--settings-accent)', color: 'var(--settings-btn-primary-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                <Check size={15} />
                <span>{t('settings.save')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <SettingRow
        title={t('settings.dataClearCache')}
        description={t('settings.dataClearCacheDesc')}
        control={
          !showClearCacheConfirm ? (
            <button type="button" className="secondaryBtn" onClick={() => setShowClearCacheConfirm(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: '1px solid var(--settings-glass-border)', background: 'var(--settings-glass-bg)', color: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Trash2 size={15} />
              <span>{t('settings.dataClearCacheAction')}</span>
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={mutedStyle}>{t('settings.dataClearCacheConfirmTitle')}</span>
              <button type="button" className="secondaryBtn" onClick={() => setShowClearCacheConfirm(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--settings-glass-border)', background: 'var(--settings-glass-bg)', color: 'inherit', fontSize: 12, cursor: 'pointer' }}>
                <XCircle size={14} />
                <span>{t('settings.keyboardCancel')}</span>
              </button>
              <button type="button" className="primaryBtn" onClick={handleClearCache} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--settings-accent)', color: 'var(--settings-btn-primary-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                <Check size={14} />
                <span>{t('settings.clear')}</span>
              </button>
            </div>
          )
        }
      />

      <SettingRow
        title={t('settings.dataResetAll')}
        description={t('settings.dataResetAllDesc')}
        control={
          !showResetConfirm ? (
            <button
              type="button"
              className="secondaryBtn"
              onClick={() => setShowResetConfirm(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: '1px solid var(--settings-danger-border)', background: 'var(--settings-danger-bg)', color: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <RotateCcw size={15} />
              <span>{t('settings.dataResetAllAction')}</span>
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={mutedStyle}>{t('settings.dataResetAllConfirmTitle')}</span>
              <button type="button" className="secondaryBtn" onClick={() => setShowResetConfirm(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--settings-glass-border)', background: 'var(--settings-glass-bg)', color: 'inherit', fontSize: 12, cursor: 'pointer' }}>
                <XCircle size={14} />
                <span>{t('settings.keyboardCancel')}</span>
              </button>
              <button
                type="button"
                className="primaryBtn"
                onClick={handleResetAll}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--settings-danger)', color: 'var(--settings-btn-primary-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                <Check size={14} />
                <span>{t('settings.dataResetAllAction')}</span>
              </button>
            </div>
          )
        }
      />

      <Callout title={t('settings.dataClearCacheConfirmTitle')} body={t('settings.dataClearCacheConfirmDesc')} />

      <div style={{ marginTop: 24 }}>
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 15, display: 'block', marginBottom: 2 }}>{t('settings.dataKeyDetail')}</strong>
          <span style={mutedStyle}>{t('settings.dataKeyDetailDesc')}</span>
        </div>
        {agenthubKeys.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {agenthubKeys.map((item) => (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--settings-glass-bg)',
                  border: '1px solid var(--settings-glass-border)',
                  opacity: item.isCache ? 0.6 : 1,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{item.key}</code>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--settings-muted)', background: 'var(--settings-chip-bg)', padding: '1px 6px', borderRadius: 4 }}>
                      {keyCategoryLabel(item.key)}
                    </span>
                    {item.isCache && (
                      <span style={{ fontSize: 11, color: 'var(--settings-status-warning)', background: 'var(--settings-status-warning-bg)', padding: '1px 6px', borderRadius: 4 }}>
                        {t('settings.dataCacheKeys')}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--settings-muted)', whiteSpace: 'nowrap' }}>{formatBytes(item.size)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.dataKeyDetail')} description={t('settings.dataNoKeys')} />
        )}
      </div>
    </Panel>
  );
}
