import { describe, expect, it } from 'vitest';
import {
  buildChatFlowEvidenceManifest,
  validateChatFlowEvidenceManifest,
} from './e2eEvidenceManifest';

describe('chat-flow evidence manifest contract', () => {
  it('builds a machine-honest manifest with commands, screenshots, and metrics', () => {
    const manifest = buildChatFlowEvidenceManifest({
      scenario: 'desktop-chat-flow',
      surface: 'desktop',
      dataSource: 'local-mock',
      authExecution: 'anonymous',
      rows: [
        {
          id: 'desktop-playwright',
          claim: 'Desktop chat flow keeps submitted messages visible',
          evidenceLevel: 'playwright-ui',
          realTested: false,
          status: 'passed',
          command: 'corepack pnpm --dir app/desktop test:e2e:chat-flow',
        },
        {
          id: 'desktop-visual',
          claim: 'Desktop chat flow has no overflow at 1440x810',
          evidenceLevel: 'visual-qa',
          realTested: false,
          status: 'passed',
          command: 'corepack pnpm --dir app/desktop test:visual:chat-flow',
          screenshots: [
            {
              name: 'desktop-chat-flow',
              path: 'app/desktop/.tmp/manual-chat-flow-uiux/desktop-1440x810-chat-flow.png',
              viewport: { width: 1440, height: 810 },
            },
          ],
          metrics: [
            { name: 'horizontalOverflowPx', value: 0, passed: true },
            { name: 'scrollGapPx', value: 0, passed: true },
          ],
        },
      ],
    });

    expect(manifest).toMatchObject({
      schema: 'agenthub.chat_flow_evidence_manifest.v1',
      scenario: 'desktop-chat-flow',
      surface: 'desktop',
      data_source: 'local-mock',
      auth_execution: 'anonymous',
      evidence_levels: ['playwright-ui', 'visual-qa'],
      real_tested: false,
      rows: [
        {
          id: 'desktop-playwright',
          evidence_level: 'playwright-ui',
          real_tested: false,
          command: 'corepack pnpm --dir app/desktop test:e2e:chat-flow',
        },
        {
          id: 'desktop-visual',
          evidence_level: 'visual-qa',
          real_tested: false,
          screenshots: [
            {
              name: 'desktop-chat-flow',
              path: 'app/desktop/.tmp/manual-chat-flow-uiux/desktop-1440x810-chat-flow.png',
              viewport: { width: 1440, height: 810 },
            },
          ],
          metrics: [
            { name: 'horizontalOverflowPx', value: 0, passed: true },
            { name: 'scrollGapPx', value: 0, passed: true },
          ],
        },
      ],
    });
    expect(validateChatFlowEvidenceManifest(manifest)).toEqual({ ok: true, errors: [] });
  });

  it('rejects stubbed, fixture, or readiness rows that claim real execution', () => {
    const manifest = buildChatFlowEvidenceManifest({
      scenario: 'web-stubbed-hub-replay',
      surface: 'web',
      dataSource: 'stubbed-hub-session',
      authExecution: 'hub-signed-in',
      rows: [
        {
          id: 'web-stubbed',
          claim: 'Web replay uses Hub-shaped stub data',
          evidenceLevel: 'stubbed-hub',
          realTested: true,
          status: 'passed',
          command: 'corepack pnpm --dir app/web test:e2e:stubbed-hub',
        },
      ],
    });

    expect(validateChatFlowEvidenceManifest(manifest)).toEqual({
      ok: false,
      errors: [
        'web-stubbed-hub-replay row web-stubbed uses stubbed-hub evidence but sets real_tested=true',
        'web-stubbed-hub-replay sets real_tested=true without an approved-real evidence row',
      ],
    });
  });

  it('records observed-local rows as read-only and non-real', () => {
    const manifest = buildChatFlowEvidenceManifest({
      scenario: 'desktop-observed-local',
      surface: 'desktop',
      dataSource: 'observed-hub-replay',
      authExecution: 'local-only',
      rows: [
        {
          id: 'observed-edge-health',
          claim: 'Local Edge was observed without model/API spend',
          evidenceLevel: 'observed-local',
          realTested: false,
          status: 'passed',
          command: 'pwsh ./scripts/smoke/verify-localhost-real-services.ps1',
        },
      ],
    });

    expect(manifest).toMatchObject({
      evidence_levels: ['observed-local'],
      real_tested: false,
      rows: [
        {
          id: 'observed-edge-health',
          evidence_level: 'observed-local',
          real_tested: false,
        },
      ],
    });
    expect(validateChatFlowEvidenceManifest(manifest)).toEqual({ ok: true, errors: [] });
  });

  it('requires approved-real rows to carry approval and real login plus CLI/model evidence claims', () => {
    const manifest = buildChatFlowEvidenceManifest({
      scenario: 'approved-real-missing-claims',
      surface: 'desktop',
      dataSource: 'approved-real-preflight',
      authExecution: 'approved-real',
      rows: [
        {
          id: 'approved-real-row',
          claim: 'Approved real path ran',
          evidenceLevel: 'approved-real',
          realTested: true,
          status: 'passed',
          command: 'pwsh ./scripts/verify/verify-approved-real-preflight.ps1 -ManifestPath approved.json',
        },
      ],
    });

    expect(validateChatFlowEvidenceManifest(manifest)).toEqual({
      ok: false,
      errors: [
        'approved-real-missing-claims row approved-real-row sets real_tested=true without approval_ref',
        'approved-real-missing-claims row approved-real-row sets real_tested=true without real_login claim',
        'approved-real-missing-claims row approved-real-row sets real_tested=true without real_cli_or_model claim',
      ],
    });
  });

  it('accepts approved-real rows only when the real evidence claims are explicit', () => {
    const manifest = buildChatFlowEvidenceManifest({
      scenario: 'approved-real-gold-path',
      surface: 'desktop',
      dataSource: 'approved-real-preflight',
      authExecution: 'approved-real',
      rows: [
        {
          id: 'approved-real-row',
          claim: 'Approved real login and CLI/model path ran',
          evidenceLevel: 'approved-real',
          realTested: true,
          status: 'passed',
          command: 'pwsh ./scripts/smoke/verify-p0-approved-real-gold-path.ps1',
          approvalRef: 'approval-2026-06-29-001',
          claims: {
            realLogin: true,
            realCliOrModel: true,
          },
        },
      ],
    });

    expect(validateChatFlowEvidenceManifest(manifest)).toEqual({ ok: true, errors: [] });
    expect(manifest.real_tested).toBe(true);
  });

  it('rejects packaged Desktop and release claims without matching evidence levels', () => {
    const manifest = buildChatFlowEvidenceManifest({
      scenario: 'desktop-vite-chat-flow',
      surface: 'desktop',
      dataSource: 'local-mock',
      authExecution: 'anonymous',
      rows: [
        {
          id: 'desktop-vite',
          claim: 'Desktop Vite renderer chat flow passed',
          evidenceLevel: 'playwright-ui',
          realTested: false,
          status: 'passed',
          command: 'corepack pnpm --dir app/desktop test:e2e:chat-flow',
          claims: {
            packagedDesktop: true,
            releaseUpload: true,
          },
        },
      ],
    });

    expect(validateChatFlowEvidenceManifest(manifest)).toEqual({
      ok: false,
      errors: [
        'desktop-vite-chat-flow row desktop-vite claims packaged Desktop without packaged-release evidence',
        'desktop-vite-chat-flow row desktop-vite claims release upload without packaged-release evidence',
      ],
    });
  });

  it('keeps packaged Desktop and release upload claims on packaged-release evidence only', () => {
    const manifest = buildChatFlowEvidenceManifest({
      scenario: 'desktop-packaged-release',
      surface: 'desktop',
      dataSource: 'approved-real-preflight',
      authExecution: 'approved-real',
      rows: [
        {
          id: 'tauri-package',
          claim: 'Tauri package policy and release dry gate passed',
          evidenceLevel: 'packaged-release',
          realTested: false,
          status: 'passed',
          command: 'pwsh ./scripts/release/verify-tauri-package-dry.ps1',
          claims: {
            packagedDesktop: true,
            releaseUpload: true,
          },
        },
      ],
    });

    expect(validateChatFlowEvidenceManifest(manifest)).toEqual({ ok: true, errors: [] });
    expect(manifest.real_tested).toBe(false);
    expect(manifest.evidence_levels).toEqual(['packaged-release']);
  });
});
