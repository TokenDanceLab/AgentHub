import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionImportList } from './SessionImportList';

describe('SessionImportList', () => {
  it('renders runtime, title, updatedAt, and import mode badge', () => {
    render(
      <SessionImportList
        items={[
          {
            id: 'sess-a',
            runtime: 'claude-code',
            title: 'sess-a',
            updatedAt: '2026-07-19T00:00:00Z',
            sourceMode: 'import',
          },
        ]}
      />
    );
    expect(screen.getByText('sess-a')).toBeTruthy();
    expect(screen.getByText('claude-code')).toBeTruthy();
    expect(screen.getByText('2026-07-19T00:00:00Z')).toBeTruthy();
    expect(screen.getByText('导入/观察')).toBeTruthy();
  });

  it('shows empty label when no items', () => {
    render(<SessionImportList items={[]} emptyLabel="无会话" />);
    expect(screen.getByText('无会话')).toBeTruthy();
  });

  it('uses custom sourceModeLabel when provided', () => {
    render(
      <SessionImportList
        items={[
          {
            id: '1',
            runtime: 'codex',
            title: 'sess-b',
            sourceMode: 'import',
          },
        ]}
        sourceModeLabel={() => '观察模式'}
      />
    );
    expect(screen.getByText('观察模式')).toBeTruthy();
  });
});
