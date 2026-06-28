import type { E2EDataSource, E2ESurface } from './e2eDataModeContract';

export type ChatFlowEvidenceLevel =
  | 'fixture-unit'
  | 'playwright-ui'
  | 'visual-qa'
  | 'stubbed-hub'
  | 'observed-local'
  | 'approved-real'
  | 'backend-api'
  | 'performance-leak'
  | 'packaged-release';

export type ChatFlowAuthExecution =
  | 'anonymous'
  | 'local-only'
  | 'hub-signed-in'
  | 'approved-real';

export type ChatFlowEvidenceStatus = 'passed' | 'failed' | 'skipped';

export interface ChatFlowEvidenceViewport {
  width: number;
  height: number;
}

export interface ChatFlowEvidenceScreenshot {
  name: string;
  path: string;
  viewport?: ChatFlowEvidenceViewport;
}

export interface ChatFlowEvidenceMetric {
  name: string;
  value: number | string | boolean;
  unit?: string;
  passed?: boolean;
}

export interface ChatFlowEvidenceClaimsInput {
  realLogin?: boolean;
  realCliOrModel?: boolean;
  packagedDesktop?: boolean;
  releaseUpload?: boolean;
}

export interface ChatFlowEvidenceClaims {
  real_login?: boolean;
  real_cli_or_model?: boolean;
  packaged_desktop?: boolean;
  release_upload?: boolean;
}

export interface ChatFlowEvidenceRowInput {
  id: string;
  claim: string;
  evidenceLevel: ChatFlowEvidenceLevel;
  realTested: boolean;
  status: ChatFlowEvidenceStatus;
  command?: string;
  screenshots?: ChatFlowEvidenceScreenshot[];
  metrics?: ChatFlowEvidenceMetric[];
  claims?: ChatFlowEvidenceClaimsInput;
  approvalRef?: string;
}

export interface ChatFlowEvidenceRow {
  id: string;
  claim: string;
  evidence_level: ChatFlowEvidenceLevel;
  real_tested: boolean;
  status: ChatFlowEvidenceStatus;
  command?: string;
  screenshots?: ChatFlowEvidenceScreenshot[];
  metrics?: ChatFlowEvidenceMetric[];
  claims?: ChatFlowEvidenceClaims;
  approval_ref?: string;
}

export interface ChatFlowEvidenceManifestInput {
  scenario: string;
  surface: E2ESurface;
  dataSource: E2EDataSource;
  authExecution: ChatFlowAuthExecution;
  rows: ChatFlowEvidenceRowInput[];
}

export interface ChatFlowEvidenceManifest {
  schema: 'agenthub.chat_flow_evidence_manifest.v1';
  scenario: string;
  surface: E2ESurface;
  data_source: E2EDataSource;
  auth_execution: ChatFlowAuthExecution;
  evidence_levels: ChatFlowEvidenceLevel[];
  real_tested: boolean;
  rows: ChatFlowEvidenceRow[];
}

export interface ChatFlowEvidenceManifestValidation {
  ok: boolean;
  errors: string[];
}

const REAL_EXECUTION_LEVEL: ChatFlowEvidenceLevel = 'approved-real';

export function buildChatFlowEvidenceManifest(input: ChatFlowEvidenceManifestInput): ChatFlowEvidenceManifest {
  const rows = input.rows.map(normalizeEvidenceRow);
  return {
    schema: 'agenthub.chat_flow_evidence_manifest.v1',
    scenario: input.scenario,
    surface: input.surface,
    data_source: input.dataSource,
    auth_execution: input.authExecution,
    evidence_levels: unique(rows.filter((row) => row.status !== 'skipped').map((row) => row.evidence_level)),
    real_tested: rows.some((row) => row.real_tested),
    rows,
  };
}

export function validateChatFlowEvidenceManifest(
  manifest: ChatFlowEvidenceManifest,
): ChatFlowEvidenceManifestValidation {
  const errors: string[] = [];
  const scenario = manifest.scenario || '(unknown scenario)';

  if (manifest.schema !== 'agenthub.chat_flow_evidence_manifest.v1') {
    errors.push(`${scenario} manifest schema must be agenthub.chat_flow_evidence_manifest.v1`);
  }
  if (!manifest.scenario) errors.push('manifest scenario is required');
  if (!manifest.surface) errors.push(`${scenario} manifest surface is required`);
  if (!manifest.data_source) errors.push(`${scenario} manifest data_source is required`);
  if (!manifest.auth_execution) errors.push(`${scenario} manifest auth_execution is required`);
  if (!Array.isArray(manifest.rows) || manifest.rows.length === 0) {
    errors.push(`${scenario} manifest must include at least one evidence row`);
  }

  const approvedRealRows = manifest.rows?.filter((row) => (
    row.evidence_level === REAL_EXECUTION_LEVEL && row.real_tested
  )) ?? [];

  for (const row of manifest.rows ?? []) {
    validateEvidenceRow(scenario, row, errors);
  }

  if (manifest.real_tested && approvedRealRows.length === 0) {
    errors.push(`${scenario} sets real_tested=true without an approved-real evidence row`);
  }

  return { ok: errors.length === 0, errors };
}

export function assertChatFlowEvidenceManifest(manifest: ChatFlowEvidenceManifest): void {
  const validation = validateChatFlowEvidenceManifest(manifest);
  if (!validation.ok) {
    throw new Error(validation.errors.join('\n'));
  }
}

function normalizeEvidenceRow(row: ChatFlowEvidenceRowInput): ChatFlowEvidenceRow {
  return {
    id: row.id,
    claim: row.claim,
    evidence_level: row.evidenceLevel,
    real_tested: row.realTested,
    status: row.status,
    ...(row.command ? { command: row.command } : {}),
    ...(row.screenshots?.length ? { screenshots: row.screenshots } : {}),
    ...(row.metrics?.length ? { metrics: row.metrics } : {}),
    ...(row.claims ? { claims: normalizeClaims(row.claims) } : {}),
    ...(row.approvalRef ? { approval_ref: row.approvalRef } : {}),
  };
}

function normalizeClaims(claims: ChatFlowEvidenceClaimsInput): ChatFlowEvidenceClaims {
  return {
    ...(claims.realLogin !== undefined ? { real_login: claims.realLogin } : {}),
    ...(claims.realCliOrModel !== undefined ? { real_cli_or_model: claims.realCliOrModel } : {}),
    ...(claims.packagedDesktop !== undefined ? { packaged_desktop: claims.packagedDesktop } : {}),
    ...(claims.releaseUpload !== undefined ? { release_upload: claims.releaseUpload } : {}),
  };
}

function validateEvidenceRow(
  scenario: string,
  row: ChatFlowEvidenceRow,
  errors: string[],
): void {
  if (!row.id) errors.push(`${scenario} evidence row id is required`);
  if (!row.claim) errors.push(`${scenario} row ${row.id || '(unknown row)'} claim is required`);
  if (!row.evidence_level) errors.push(`${scenario} row ${row.id || '(unknown row)'} evidence_level is required`);
  if (row.status !== 'skipped' && !row.command) {
    errors.push(`${scenario} row ${row.id || '(unknown row)'} command is required for non-skipped evidence`);
  }
  if (row.real_tested && row.evidence_level !== REAL_EXECUTION_LEVEL) {
    errors.push(`${scenario} row ${row.id} uses ${row.evidence_level} evidence but sets real_tested=true`);
  }
  if (row.real_tested && row.evidence_level === REAL_EXECUTION_LEVEL) {
    if (!row.approval_ref) {
      errors.push(`${scenario} row ${row.id} sets real_tested=true without approval_ref`);
    }
    if (row.claims?.real_login !== true) {
      errors.push(`${scenario} row ${row.id} sets real_tested=true without real_login claim`);
    }
    if (row.claims?.real_cli_or_model !== true) {
      errors.push(`${scenario} row ${row.id} sets real_tested=true without real_cli_or_model claim`);
    }
  }
  if (row.claims?.real_login && row.evidence_level !== REAL_EXECUTION_LEVEL) {
    errors.push(`${scenario} row ${row.id} claims real login without approved-real evidence`);
  }
  if (row.claims?.real_cli_or_model && row.evidence_level !== REAL_EXECUTION_LEVEL) {
    errors.push(`${scenario} row ${row.id} claims real CLI/model/API without approved-real evidence`);
  }
  if (row.claims?.packaged_desktop && row.evidence_level !== 'packaged-release') {
    errors.push(`${scenario} row ${row.id} claims packaged Desktop without packaged-release evidence`);
  }
  if (row.claims?.release_upload && row.evidence_level !== 'packaged-release') {
    errors.push(`${scenario} row ${row.id} claims release upload without packaged-release evidence`);
  }
  validateScreenshots(scenario, row, errors);
  validateMetrics(scenario, row, errors);
}

function validateScreenshots(
  scenario: string,
  row: ChatFlowEvidenceRow,
  errors: string[],
): void {
  for (const screenshot of row.screenshots ?? []) {
    if (!screenshot.name) errors.push(`${scenario} row ${row.id} screenshot name is required`);
    if (!screenshot.path) errors.push(`${scenario} row ${row.id} screenshot path is required`);
    if (screenshot.viewport && (screenshot.viewport.width <= 0 || screenshot.viewport.height <= 0)) {
      errors.push(`${scenario} row ${row.id} screenshot viewport must be positive`);
    }
  }
}

function validateMetrics(
  scenario: string,
  row: ChatFlowEvidenceRow,
  errors: string[],
): void {
  for (const metric of row.metrics ?? []) {
    if (!metric.name) errors.push(`${scenario} row ${row.id} metric name is required`);
    if (metric.value === undefined || metric.value === null) {
      errors.push(`${scenario} row ${row.id} metric ${metric.name || '(unknown metric)'} value is required`);
    }
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
