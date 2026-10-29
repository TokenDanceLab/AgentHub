import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@shared/ui';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { createHubClient, type HubEdgeEnrollmentPreview } from '@/api/hubClient';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import { getBrowserSessionGeneration } from '@/api/browserSessionRuntime';
import { isPairedEdgeTarget } from '@/platform/webPlatformDispatchHelpers';
import styles from './EdgePairingPanel.module.css';

export function EdgePairingPanel() {
  const { t, i18n } = useTranslation('common');
  const inputId = useId();
  const client = useMemo(() => createHubClient(), []);
  const queryClient = useQueryClient();
  const targets = useHubExecutionTargets({ enabled: true });
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<HubEdgeEnrollmentPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expired, setExpired] = useState(false);
  const [revokeId, setRevokeId] = useState<string>();
  const operation = useRef(false);
  const mounted = useRef(false);
  const pairedTargets = (targets.data?.items ?? []).filter(isPairedEdgeTarget);
  const normalizedCode = code.trim().toUpperCase();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function beginOperation() {
    if (operation.current) return undefined;
    operation.current = true;
    setBusy(true);
    const generation = getBrowserSessionGeneration();
    return () => mounted.current && generation === getBrowserSessionGeneration();
  }

  function finishOperation(current: () => boolean) {
    operation.current = false;
    if (current()) setBusy(false);
  }

  useEffect(() => {
    if (!preview || preview.status !== 'pending') return;
    const delay = Date.parse(preview.expires_at) - Date.now();
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Math.min(delay, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [preview]);

  async function refreshTargets() {
    await queryClient.invalidateQueries({ queryKey: hubQueryKeys.executionTargets.root });
  }

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    if (!/^[A-Z2-7]{5}-?[A-Z2-7]{5}$/.test(normalizedCode)) return;
    const current = beginOperation();
    if (!current) return;
    setError('');
    setNotice('');
    setPreview(undefined);
    setExpired(false);
    try {
      const result = await client.previewEdgeEnrollment(normalizedCode);
      if (!current()) return;
      setPreview(result);
      setExpired(!Number.isFinite(Date.parse(result.expires_at)) || Date.parse(result.expires_at) <= Date.now());
    } catch {
      if (current()) setError(t('edgePairing.lookupFailed'));
    } finally {
      finishOperation(current);
    }
  }

  async function confirm() {
    if (!preview || preview.status !== 'pending' || expired) return;
    if (!Number.isFinite(Date.parse(preview.expires_at)) || Date.parse(preview.expires_at) <= Date.now()) { setExpired(true); return; }
    const current = beginOperation();
    if (!current) return;
    setError('');
    try {
      await client.confirmEdgeEnrollment(normalizedCode);
      if (!current()) return;
      setPreview({ ...preview, status: 'confirmed' });
      setNotice(t('edgePairing.confirmed'));
      void refreshTargets();
    } catch {
      // A code may expire or be consumed while its preview is open. Require a
      // fresh preview before another confirmation attempt.
      if (current()) {
        setPreview(undefined);
        setError(t('edgePairing.confirmFailed'));
      }
    } finally {
      finishOperation(current);
    }
  }

  async function revoke(deviceId: string) {
    const current = beginOperation();
    if (!current) return;
    setError('');
    setNotice('');
    try {
      await client.revokeEdgeDevice(deviceId);
      if (!current()) return;
      setRevokeId(undefined);
      setNotice(t('edgePairing.revoked'));
      void refreshTargets();
    } catch {
      if (current()) setError(t('edgePairing.revokeFailed'));
    } finally {
      finishOperation(current);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${inputId}-title`} aria-busy={busy}>
      <h2 id={`${inputId}-title`}>{t('edgePairing.title')}</h2>
      <p id={`${inputId}-help`}>{t('edgePairing.description')}</p>
      <form className={styles.form} onSubmit={(event) => void lookup(event)}>
        <label htmlFor={inputId}>{t('edgePairing.code')}</label>
        <div className={styles.actions}>
          <Input className={styles.codeInput} mono id={inputId} value={code} disabled={busy} maxLength={11} autoComplete="off" autoCapitalize="characters"
            spellCheck={false} aria-describedby={`${inputId}-help`} placeholder="ABCDE-FG234"
            onChange={(event) => { setCode(event.target.value); setPreview(undefined); setExpired(false); setError(''); setNotice(''); }} />
          <Button type="submit" disabled={busy || !/^[A-Z2-7]{5}-?[A-Z2-7]{5}$/.test(normalizedCode)}>
            {busy ? t('edgePairing.working') : t('edgePairing.preview')}
          </Button>
        </div>
      </form>
      {preview && <div className={styles.preview}>
        <dl className={styles.details}>
          <dt>{t('edgePairing.name')}</dt><dd>{preview.name}</dd>
          <dt>{t('edgePairing.device')}</dt><dd>{preview.device_id}</dd>
          <dt>{t('edgePairing.runtime')}</dt><dd>{preview.runtime_id}</dd>
          <dt>{t('edgePairing.workspace')}</dt><dd><code>{preview.workspace_root}</code></dd>
          <dt>{t('edgePairing.expires')}</dt><dd>{new Date(preview.expires_at).toLocaleString(i18n.language)}</dd>
        </dl>
        <p>{t('edgePairing.textOnly')}</p>
        {expired ? <p role="status">{t('edgePairing.expired')}</p> : preview.status === 'pending' ? <>
          <p>{t('edgePairing.verify')}</p>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void confirm()}>{t('edgePairing.confirm')}</Button>
        </> : <p role="status">{t('edgePairing.alreadyConfirmed')}</p>}
      </div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pairedTargets.length > 0 && <div className={styles.paired}>
        <h3>{t('edgePairing.paired')}</h3>
        <p>{t('edgePairing.profileHint')}</p>
        {pairedTargets.map((target) => <div key={target.id} className={styles.device}>
          <div><strong>{target.name}</strong><p><code>{target.workspace_root}</code></p><p>{t('edgePairing.textOnly')}</p></div>
          {target.device_id && (revokeId === target.device_id ? <div className={styles.actions}>
            <p>{t('edgePairing.revokeWarning')}</p>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => { if (target.device_id) void revoke(target.device_id); }}>{t('edgePairing.confirmRevoke')}</Button>
            <Button type="button" disabled={busy} onClick={() => setRevokeId(undefined)}>{t('edgePairing.cancel')}</Button>
          </div> : <Button type="button" disabled={busy} onClick={() => setRevokeId(target.device_id)}>{t('edgePairing.revoke')}</Button>)}
        </div>)}
      </div>}
    </section>
  );
}
