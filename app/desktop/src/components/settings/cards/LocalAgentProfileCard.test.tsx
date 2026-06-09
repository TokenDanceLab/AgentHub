import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocalAgentProfileCard from './LocalAgentProfileCard';
import type { AgentInfo } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const text: Record<string, string> = {
        'settings.profileEditAria': `Edit ${values?.runtime} profile`,
        'settings.localProfileName': `${values?.runtime} local profile`,
        'settings.localProfileDesc': 'Local Agent Profile overrides for this runtime.',
        'settings.enabled': 'Enabled',
        'settings.notConfigured': 'Not configured',
        'settings.agentProfileSummaryModel': `Model ${values?.model}`,
        'settings.agentProfileSummaryProvider': `Provider ${values?.provider}`,
        'settings.agentProfileSummaryCustom': 'Custom overrides',
        'settings.agentProfileSummaryDefault': 'Using defaults',
        'settings.agentProfileSummaryTarget': 'Local Edge target',
        'settings.agentProfileSystemPrompt': 'System Prompt',
        'settings.agentProfileTokenCount': `${values?.count} tokens`,
        'settings.agentProfileSystemPromptPlaceholder': `Instructions for ${values?.runtime}`,
        'settings.agentProfileCharCount': `${values?.count} chars`,
        'settings.agentProfileTools': 'Tool Permissions',
        'settings.agentProfileToolsEnabled': `${values?.count}/${values?.total} enabled`,
        'settings.agentProfileWebSearch': 'Web Search',
        'settings.agentProfileWebSearchDesc': 'Allow agent to search the web during execution',
        'settings.agentProfileModelOverride': 'Model Override',
        'settings.agentProfileModelOverrideDesc': 'Leave empty to use global defaults',
        'settings.modelAliasModel': 'Model',
        'settings.agentProfileProvider': 'Provider',
        'settings.agentProfileReasoning': 'Reasoning',
        'settings.agentProfileUseDefault': 'Use default',
        'settings.agentProfileModelParams': 'Model Parameters',
        'settings.agentProfileModelParamsDesc': 'Fine-tune generation behavior',
        'settings.agentProfileTemperature': 'Temperature',
        'settings.agentProfileTemperatureHint': 'Lower = more deterministic, higher = more creative',
        'settings.agentProfileTopP': 'Top P',
        'settings.agentProfileTopPHint': 'Nucleus sampling',
        'settings.agentProfileMaxTokens': 'Max Output Tokens',
        'settings.agentProfileMaxTokensHint': 'Maximum tokens',
        'settings.agentProfileMcpServers': 'MCP Server Attachments',
        'settings.agentProfileMcpServersDesc': 'MCP server config files or URLs to attach to this profile',
        'settings.agentProfileAddServer': 'Add',
        'settings.agentProfileMcpPlaceholder': 'MCP config path or URL...',
        'settings.agentProfileToggleServer': 'Toggle server',
        'settings.agentProfileRemove': 'Remove',
        'settings.agentProfileSkillLinks': 'Skill / Knowledge Base Links',
        'settings.agentProfileSkillLinksDesc': 'Paths to skill directories or knowledge base files to include',
        'settings.agentProfileAddLink': 'Add',
        'settings.agentProfileSkillPlaceholder': 'Skill path or knowledge base URI...',
        'settings.agentProfileStorage': 'Saved on this device only; Hub Agent Profile sync is not configured.',
        'settings.agentProfileStorageUnsaved': 'Unsaved local changes; Hub Agent Profile is unchanged.',
        'settings.agentProfileStorageError': 'Local save failed: {{error}}',
        'settings.agentProfileResetDefaults': 'Reset to defaults',
        'settings.agentProfileSaveChanges': 'Save Changes',
        'settings.agentProfileSaved': 'Saved locally',
        'prompt.routeAuto': 'Auto',
        'settings.tool.readDesc': 'Read files',
        'settings.tool.writeDesc': 'Write files',
        'settings.tool.bashDesc': 'Shell commands',
        'settings.tool.grepDesc': 'Search text',
        'settings.tool.globDesc': 'Find files',
        'settings.tool.webFetchDesc': 'Fetch URLs',
        'settings.tool.webSearchDesc': 'Search web',
        'settings.tool.taskDesc': 'Spawn tasks',
      };
      return text[key]?.replace('{{error}}', String(values?.error)) ?? key;
    },
  }),
}));

const agent: AgentInfo = {
  id: 'codex-local',
  name: 'Codex',
  status: 'available',
  capabilities: {
    streaming: true,
    tools: true,
    vision: false,
    multiTurn: true,
    mcpIntegration: true,
    permissionHooks: true,
    subAgentSpawn: true,
  },
};

function renderCard() {
  return render(
    <LocalAgentProfileCard
      agent={agent}
      edgeOnline
      route={{ model: 'gpt-5.1-codex', provider: 'tokendance-gateway', reasoningEffort: 'medium' }}
    />,
  );
}

describe('LocalAgentProfileCard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('labels profile edits as local-only until Hub Agent Profile sync exists', () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Codex profile' }));

    expect(screen.getByText('Saved on this device only; Hub Agent Profile sync is not configured.')).toBeInTheDocument();
    expect(screen.queryByText(/synced to Hub/i)).not.toBeInTheDocument();
  });

  it('distinguishes unsaved local changes from Hub profile sync', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Codex profile' }));

    fireEvent.change(screen.getByPlaceholderText('Instructions for Codex'), {
      target: { value: 'Use the local workspace context.' },
    });

    expect(screen.getByText('Unsaved local changes; Hub Agent Profile is unchanged.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('surfaces localStorage save failures instead of claiming the profile is saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Codex profile' }));
    fireEvent.change(screen.getByPlaceholderText('Instructions for Codex'), {
      target: { value: 'Persist me.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(screen.getByText('Local save failed: quota exceeded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });
});
