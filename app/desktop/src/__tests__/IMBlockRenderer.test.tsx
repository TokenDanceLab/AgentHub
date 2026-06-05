import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import IMBlockRenderer from '@/components/IM/IMBlockRenderer';
import type { MessageBlock } from '@/components/ChatView.types';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

function renderBlocks(blocks: MessageBlock[]) {
  return render(<IMBlockRenderer content="" blocks={blocks} />);
}

describe('IMBlockRenderer — new block types', () => {
  it('renders child_agent block with title and agent name', () => {
    const block: MessageBlock = {
      kind: 'child_agent',
      childId: 'child-1',
      title: 'Research Agent',
      status: 'running',
      agentName: 'ResearchBot',
    };
    renderBlocks([block]);
    expect(screen.getByText('Research Agent')).toBeInTheDocument();
    expect(screen.getByText('ResearchBot')).toBeInTheDocument();
  });

  it('renders child_agent block with result when expanded', () => {
    const block: MessageBlock = {
      kind: 'child_agent',
      childId: 'child-2',
      title: 'Code Agent',
      status: 'completed',
      result: 'Refactored 3 files',
    };
    renderBlocks([block]);
    expect(screen.getByText('Code Agent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Refactored 3 files')).toBeInTheDocument();
  });

  it('renders child_agent block with error', () => {
    const block: MessageBlock = {
      kind: 'child_agent',
      childId: 'child-3',
      title: 'Fail Agent',
      status: 'failed',
      error: 'timeout exceeded',
    };
    renderBlocks([block]);
    expect(screen.getByText('Fail Agent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('timeout exceeded')).toBeInTheDocument();
  });

  it('renders child_agent fallback to childId when no title', () => {
    const block: MessageBlock = {
      kind: 'child_agent',
      childId: 'child-orphan',
      title: '',
      status: 'pending',
    };
    renderBlocks([block]);
    expect(screen.getByText('child-orphan')).toBeInTheDocument();
  });

  it('renders route_decision block with action', () => {
    const block: MessageBlock = {
      kind: 'route_decision',
      action: 'delegate',
      nextWorker: 'coder',
      summary: 'Routing to coder agent',
    };
    renderBlocks([block]);
    expect(screen.getByText('delegate')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Routing to coder agent')).toBeInTheDocument();
  });

  it('renders route_decision block with blocked reason', () => {
    const block: MessageBlock = {
      kind: 'route_decision',
      action: 'blocked',
      blockedReason: 'awaiting approval',
    };
    renderBlocks([block]);
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('awaiting approval')).toBeInTheDocument();
  });

  it('renders route_decision block with reasoning when expanded', () => {
    const block: MessageBlock = {
      kind: 'route_decision',
      action: 'retry',
      reasoning: 'Network timeout caused failure',
    };
    renderBlocks([block]);
    expect(screen.getByText('retry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Network timeout caused failure')).toBeInTheDocument();
  });

  it('renders artifact block with type and title', () => {
    const block: MessageBlock = {
      kind: 'artifact',
      artifactId: 'art-1',
      artifactType: 'document',
      title: 'Final Report',
    };
    renderBlocks([block]);
    expect(screen.getByText('document')).toBeInTheDocument();
    expect(screen.getByText('Final Report')).toBeInTheDocument();
  });

  it('renders artifact block with URL as link', () => {
    const block: MessageBlock = {
      kind: 'artifact',
      artifactId: 'art-2',
      artifactType: 'image',
      title: 'Screenshot',
      artifactUrl: 'https://example.com/img.png',
    };
    renderBlocks([block]);
    const link = screen.getByText('https://example.com/img.png');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/img.png');
  });

  it('renders artifact block with size', () => {
    const block: MessageBlock = {
      kind: 'artifact',
      artifactId: 'art-3',
      artifactType: 'file',
      title: 'Big Data',
      size: 2048,
    };
    renderBlocks([block]);
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('renders deploy_card block with status and message', () => {
    const block: MessageBlock = {
      kind: 'deploy_card',
      deployId: 'deploy-1',
      status: 'success',
      statusMessage: 'Deployed to production',
    };
    renderBlocks([block]);
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('Deployed to production')).toBeInTheDocument();
  });

  it('renders deploy_card block with URL as link', () => {
    const block: MessageBlock = {
      kind: 'deploy_card',
      deployId: 'deploy-2',
      status: 'running',
      url: 'https://app.example.com',
    };
    renderBlocks([block]);
    const link = screen.getByText('https://app.example.com');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://app.example.com');
  });

  it('renders deploy_card with failed status and message', () => {
    const block: MessageBlock = {
      kind: 'deploy_card',
      status: 'failed',
      statusMessage: 'Build error',
    };
    renderBlocks([block]);
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('Build error')).toBeInTheDocument();
  });
});

describe('IMBlockRenderer — existing blocks still render', () => {
  it('renders text block via MarkdownRenderer', () => {
    renderBlocks([{ kind: 'text', content: 'Hello **world**' }]);
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('renders tool_use block', () => {
    renderBlocks([{
      kind: 'tool_use',
      callId: 'c1',
      toolName: 'Read',
      input: { file_path: 'src/app.ts' },
      status: 'completed',
    }]);
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
  });

  it('renders thinking block toggle', () => {
    renderBlocks([{ kind: 'thinking', content: 'Deep thoughts' }]);
    expect(screen.getByText('chat.thinkingSettledLabel')).toBeInTheDocument();
  });

  it('renders approval block with agent and tool names', () => {
    renderBlocks([{
      kind: 'approval',
      approvalId: 'a1',
      status: 'pending',
      agentName: 'Bot',
      toolName: 'Bash',
    }]);
    expect(screen.getByText('Bot')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('renders file_change block', () => {
    renderBlocks([{
      kind: 'file_change',
      path: '/src/main.ts',
      action: 'modified',
    }]);
    expect(screen.getByText('modified')).toBeInTheDocument();
    expect(screen.getByText('main.ts')).toBeInTheDocument();
  });

  it('renders error block', () => {
    renderBlocks([{
      kind: 'error',
      message: 'Something went wrong',
      category: 'network',
    }]);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('falls back to markdown for plain content without blocks', () => {
    render(<IMBlockRenderer content="Plain **markdown** text" />);
    expect(screen.getByText('markdown')).toBeInTheDocument();
  });
});
