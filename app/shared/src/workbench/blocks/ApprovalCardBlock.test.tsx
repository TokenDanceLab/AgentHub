import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApprovalCardBlock } from './ApprovalCardBlock';

describe('ApprovalCardBlock', () => {
  it('matches the design approval badge structure', () => {
    const { container } = render(
      <ApprovalCardBlock
        id="approval_b0_sqlite_write"
        status="pending"
        toolName="Write File"
        risk="medium"
        reason="生成迁移 SQL 和导航 hook 更新，需要写入工作区文件。"
      />,
    );

    const title = screen.getByText('部署/写入审批');
    const riskBadge = screen.getByText('中风险');
    expect(riskBadge).toBeInTheDocument();
    expect(title.parentElement).toContainElement(riskBadge);
    expect(container.querySelector('[class*="title"] [class*="dot"]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
  });

  it('keeps a status dot after approval is resolved', () => {
    const { container } = render(
      <ApprovalCardBlock
        id="approval_b0_sqlite_write"
        status="completed"
        toolName="Write File"
      />,
    );

    expect(screen.getByText('已批准')).toBeInTheDocument();
    expect(container.querySelector('[class*="actions"] [class*="dot"]')).toBeInTheDocument();
  });
});
