import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildAgentCapabilityContractFromConfig,
  buildAgentCapabilitySummary,
} from './agentCapabilities';
import {
  assertNoBannedProductEnMeta,
  assertNoRuntimeModelStuffing,
  BANNED_PRODUCT_EN_META,
  findBannedProductEnMeta,
  findRuntimeModelStuffing,
  isAllowedTechnicalId,
} from './agentsProductCopyContract';
import { workbenchAgentToAgentConfig } from './workbenchAgentMapping';
import type { WorkbenchAgent } from '@shared/platform';

const WORKBENCH_ROOT = dirname(fileURLToPath(import.meta.url));
const AGENTS_PAGES_ROOT = join(WORKBENCH_ROOT, 'pages', 'agents');

/** Product chrome surfaces for installed list + detail (not market/ops dumps). */
const PRODUCT_CHROME_FILES = new Set([
  'AgentInstalledViews.tsx',
  'AgentInstalledParts.tsx',
  'AgentEditItemParts.tsx',
  'AgentEditPanel.tsx',
  'AgentEditHelpers.ts',
  'shared.tsx',
]);

/** Additional product-string producers outside pages/agents. */
const EXTRA_PRODUCT_COPY_FILES = [
  join(WORKBENCH_ROOT, 'agentCapabilities.ts'),
  join(WORKBENCH_ROOT, 'workbenchAgentMapping.ts'),
];

function listProductChromeSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listProductChromeSources(path);
    if (!PRODUCT_CHROME_FILES.has(entry)) return [];
    return [path];
  });
}

function productCopySources(): string[] {
  return [...listProductChromeSources(AGENTS_PAGES_ROOT), ...EXTRA_PRODUCT_COPY_FILES];
}

function baseWorkbenchAgent(overrides: Partial<WorkbenchAgent> = {}): WorkbenchAgent {
  return {
    id: 'agent-1',
    name: 'Builder',
    status: 'available',
    ...overrides,
  } as WorkbenchAgent;
}

describe('agentsProductCopyContract helper', () => {
  it('flags known engineering EN microcopy and active count suffixes', () => {
    for (const phrase of BANNED_PRODUCT_EN_META) {
      expect(findBannedProductEnMeta(`meta ${phrase} here`)).toContain(phrase);
    }
    expect(findBannedProductEnMeta('3 active')).toContain('3 active');
    expect(findBannedProductEnMeta('3 个')).toEqual([]);
    expect(findBannedProductEnMeta('Codex · openai / gpt-5')).toEqual([]);
  });

  it('flags Runtime/Model stuffing while allowing proper nouns', () => {
    expect(findRuntimeModelStuffing('Reviews - Runtime: codex - Model: gpt-5')).toHaveLength(2);
    expect(findRuntimeModelStuffing('Hub 配置档案')).toEqual([]);
    expect(isAllowedTechnicalId('Codex')).toBe(true);
    expect(isAllowedTechnicalId('claude-code')).toBe(true);
    expect(isAllowedTechnicalId('openai / gpt-5-codex')).toBe(true);
    expect(isAllowedTechnicalId('active templates')).toBe(false);
  });
});

describe('Agents installed/detail Chinese-first product chrome', () => {
  it('keeps banned engineering EN meta out of installed product chrome sources', () => {
    const offenders = productCopySources().flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      // AgentSpec fixture dump is a developer-only panel; strip that block if present.
      // Internal capability reason strings are not product chrome — strip reason fields.
      const productSource = source
        .replace(/export const AgentSpecFixturePanel[\s\S]*?(?=export const AgentEditGrid)/, '')
        .replace(/reason:\s*'[^']*'/g, "reason: ''");
      return findBannedProductEnMeta(productSource).map(
        (hit) => `${relative(WORKBENCH_ROOT, path)}: ${hit}`,
      );
    });

    expect(offenders).toEqual([]);
  });

  it('keeps capability summary product strings Chinese-first', () => {
    const partial = buildAgentCapabilitySummary(
      buildAgentCapabilityContractFromConfig({
        id: 'hub-agent',
        name: 'Hub Agent',
        role: 'Hub profile',
        engine: 'codex',
        model: 'gpt-5-codex',
        mode: 'Reasoning high',
        approval: 'default',
        scope: 'default',
        state: 'ready',
        skills: [],
        tools: {},
      }),
    );

    const ready = buildAgentCapabilitySummary(
      buildAgentCapabilityContractFromConfig({
        id: 'builder-agent',
        name: 'Builder',
        role: '实现主链改动',
        engine: 'Claude Code',
        model: 'DeepSeek-V4-Pro',
        mode: 'Plan → Code',
        approval: 'ask-before-write',
        scope: 'workspace-write',
        state: 'ready',
        skills: ['Read File'],
        tools: { 'Read File': '允许' },
        toolAllowlist: ['Read File'],
        memorySources: ['agents-md', 'project-memory'],
        memoryRetention: 'project-policy',
        memorySummary: '读取工作区说明与项目记忆',
        avatarRef: 'agenthub:avatar/builder',
        mcpServers: ['filesystem'],
      }),
    );

    for (const summary of [partial, ready]) {
      for (const value of Object.values(summary)) {
        if (typeof value !== 'string') continue;
        assertNoBannedProductEnMeta(value, 'capability summary');
      }
    }

    expect(partial.agentsMd).toBe('工作区说明未配置');
    expect(partial.avatar).toBe('使用生成首字母');
    expect(partial.memory).toBe('记忆未启用');
    expect(partial.tools).toBe('未开放工具');
    expect(ready.agentsMd).toBe('工作区说明已配置');
    expect(ready.tools).toMatch(/个工具/);
  });
});

describe('workbenchAgentToAgentConfig role/description contract', () => {
  it('keeps mapped role free of Runtime/Model stuffing', () => {
    const config = workbenchAgentToAgentConfig(
      baseWorkbenchAgent({
        description: '实现主链改动',
        runtimeId: 'codex',
        provider: 'openai',
        model: 'gpt-5',
      }),
    );

    assertNoRuntimeModelStuffing(config.role, 'workbenchAgentToAgentConfig.role');
    expect(config.role).toBe('实现主链改动');
    expect(config.engine).toBe('codex');
    expect(config.model).toBe('openai / gpt-5');
    // Dedicated fields may carry technical ids; role must not re-encode them.
    expect(config.role).not.toMatch(/Runtime|Model/i);
  });

  it('does not invent Runtime/Model suffixes when description is empty', () => {
    const config = workbenchAgentToAgentConfig(
      baseWorkbenchAgent({
        description: undefined,
        runtimeId: 'claude-code',
        model: 'sonnet',
      }),
    );

    assertNoRuntimeModelStuffing(config.role, 'fallback role');
    expect(findBannedProductEnMeta(config.role)).toEqual([]);
  });
});
