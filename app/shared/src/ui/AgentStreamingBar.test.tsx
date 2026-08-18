import React from 'react';
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { AgentStreamingBar } from './AgentStreamingBar';
import { getAgentActivityStore } from '../transcript/agentActivity';
import { useTestI18nLanguage, TEST_I18N_DEFAULT_LNG } from '../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

afterAll(async () => {
  await useTestI18nLanguage(TEST_I18N_DEFAULT_LNG);
});

afterEach(() => {
  getAgentActivityStore().reset();
});

describe('AgentStreamingBar', () => {
  it('renders nothing when no agents are active', () => {
    const { container } = render(<AgentStreamingBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows tool calls for a single agent', () => {
    const store = getAgentActivityStore();
    store.pushAgentStatus('run-1', 'Sonnet', 'thinking', 2);
    store.pushAgentStatus('run-1', 'Sonnet', 'streaming', 1);

    const { getByText } = render(<AgentStreamingBar />);
    expect(getByText('Sonnet')).toBeInTheDocument();
    expect(getByText(/3 次工具调用/)).toBeInTheDocument();
  });

  it('shows tool calls in the multi-agent summary line', () => {
    const store = getAgentActivityStore();
    store.pushAgentStatus('run-1', 'Sonnet', 'streaming', 4);
    store.pushAgentStatus('run-2', 'Opus', 'thinking', 1);

    const { getByText } = render(<AgentStreamingBar />);
    expect(getByText(/2 个 Agent 运行中 · 5 次工具调用/)).toBeInTheDocument();
  });

  it('omits the tool call label when the count is zero', () => {
    const store = getAgentActivityStore();
    store.pushAgentStatus('run-1', 'Sonnet', 'thinking');

    const { queryByText, getByText } = render(<AgentStreamingBar />);
    expect(queryByText(/次工具调用/)).not.toBeInTheDocument();
    expect(getByText('Sonnet')).toBeInTheDocument();
  });
});
