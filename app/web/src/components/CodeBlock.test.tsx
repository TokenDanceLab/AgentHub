import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import CodeBlock from './CodeBlock';

describe('CodeBlock', () => {
  beforeEach(async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    await i18n.changeLanguage('zh');
  });

  it('localizes copy control labels', async () => {
    render(<CodeBlock language="ts" content="const ready = true;" />);

    const copyButton = screen.getByRole('button', { name: '复制代码' });
    expect(copyButton).toHaveAttribute('type', 'button');

    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const ready = true;');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
    });
  });
});
