import React from 'react';
import {
  RuntimeBrandIcon,
  RuntimeIcon,
  type RuntimeIconKind,
  type RuntimeIconSize,
} from './RuntimeIcon';

type RuntimeIconExample = {
  kind: RuntimeIconKind;
  name: string;
  provider?: string;
  size?: RuntimeIconSize;
};

const lobeExamples: RuntimeIconExample[] = [
  { kind: 'runtime', name: 'Codex' },
  { kind: 'runtime', name: 'Claude Code' },
  { kind: 'runtime', name: 'OpenCode' },
  { kind: 'model', name: 'gpt-5-codex' },
  { kind: 'provider', name: 'OpenAI' },
  { kind: 'provider', name: 'Claude' },
  { kind: 'model', name: 'internal-fast', provider: 'Anthropic' },
];

const fallbackExamples: RuntimeIconExample[] = [
  { kind: 'runtime', name: 'Custom Agent' },
  { kind: 'runtime', name: 'Browser Worker' },
  { kind: 'tool', name: 'apply_patch' },
  { kind: 'tool', name: 'Git Diff' },
  { kind: 'tool', name: 'Shell' },
  { kind: 'provider', name: 'TokenDance Gateway' },
];

const meta = {
  title: 'UI/RuntimeIcon',
  component: RuntimeIcon,
};

export default meta;

export const LobeHubLogos = {
  render: () => <IconGrid examples={lobeExamples} />,
};

export const Fallbacks = {
  render: () => <IconGrid examples={fallbackExamples} />,
};

export const WorkbenchAlias = {
  render: () => (
    <IconGrid
      alias
      examples={[
        { kind: 'runtime', name: 'Codex' },
        { kind: 'model', name: 'claude-sonnet-4-20250514' },
        { kind: 'tool', name: 'Read' },
      ]}
    />
  ),
};

function IconGrid({
  alias = false,
  examples,
}: {
  alias?: boolean;
  examples: RuntimeIconExample[];
}) {
  const IconComponent = alias ? RuntimeBrandIcon : RuntimeIcon;

  return (
    <div style={gridStyle}>
      {examples.map((example) => (
        <div key={`${example.kind}-${example.provider ?? ''}-${example.name}`} style={itemStyle}>
          <IconComponent
            kind={example.kind}
            name={example.name}
            provider={example.provider}
            size={example.size ?? 'large'}
          />
          <span style={labelStyle}>{example.provider ? `${example.provider} / ${example.name}` : example.name}</span>
        </div>
      ))}
    </div>
  );
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  maxWidth: 720,
};

const itemStyle: React.CSSProperties = {
  alignItems: 'center',
  border: '1px solid var(--td-line)',
  borderRadius: 8,
  display: 'flex',
  gap: 10,
  minHeight: 56,
  padding: 12,
};

const labelStyle: React.CSSProperties = {
  color: 'var(--td-ink)',
  font: '600 13px/1.3 system-ui, sans-serif',
};
