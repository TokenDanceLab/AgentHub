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
        'desktop-vite-chat-flow row desktop-vite claims release upload without release evidence',
      ],
    });
  });
});
