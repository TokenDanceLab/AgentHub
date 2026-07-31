import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import MarkdownContent from './Markdown';
import styles from './Markdown.module.css';

function renderMarkdown(markdown: string): HTMLElement {
  return render(<MarkdownContent content={markdown} />).container;
}

describe('CJK emphasis', () => {
  test.each([
    ['这是**重要（必读）**内容', '重要（必读）'],
    ['他说**「重要」**这几个字', '「重要」'],
    ['**注意。**后续内容', '注意。'],
  ])('renders strong text next to CJK punctuation: %s', (markdown, text) => {
    const strong = renderMarkdown(markdown).querySelector('strong');
    expect(strong).toHaveTextContent(text);
  });

  test('renders single-marker emphasis next to CJK punctuation', () => {
    const emphasis = renderMarkdown('这是*重要（必读）*内容').querySelector('em');
    expect(emphasis).toHaveTextContent('重要（必读）');
  });

  test('preserves CommonMark intraword asterisk emphasis', () => {
    const container = renderMarkdown('foo**bar**baz');
    expect(container).toHaveTextContent('foobarbaz');
    expect(container.querySelector('strong')).toHaveTextContent('bar');
  });
});

describe('CJK punctuation after literal autolinks', () => {
  test.each([
    ['阅读 https://example.com/docs。下一句', 'https://example.com/docs', '。下一句'],
    ['访问 https://example.com，查看详情。', 'https://example.com', '，查看详情。'],
    ['「https://example.com/path」', 'https://example.com/path', '」'],
  ])('keeps prose outside the href: %s', (markdown, expectedHref, trailingText) => {
    const container = renderMarkdown(markdown);
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', expectedHref);
    expect(link).toHaveTextContent(expectedHref);
    expect(container).toHaveTextContent(trailingText);
  });

  test('retains balanced CJK parentheses in a bare IRI path', () => {
    const url = 'https://example.com/产品（测试）';
    const link = renderMarkdown(url).querySelector('a');
    expect(link).toHaveTextContent(url);
    expect(decodeURIComponent(link?.getAttribute('href') ?? '')).toBe(url);
  });

  test('retains punctuation in an explicit Markdown destination', () => {
    const url = 'https://example.com/版本，2';
    const link = renderMarkdown(`[${url}](${url})`).querySelector('a');
    expect(link).toHaveTextContent(url);
    expect(decodeURIComponent(link?.getAttribute('href') ?? '')).toBe(url);
  });

  test('retains percent-encoded punctuation in a bare URL', () => {
    const url = 'https://example.com/%E3%80%82';
    expect(renderMarkdown(url).querySelector('a')).toHaveAttribute('href', url);
  });

  test('keeps standard English trailing punctuation outside the link', () => {
    const link = renderMarkdown('See https://example.com/path, next.').querySelector('a');
    expect(link).toHaveAttribute('href', 'https://example.com/path');
  });
});

describe('inline code wrapping', () => {
  test('keeps long code spans inline so they can wrap visually', () => {
    const codeText = `client.fetch(${Array.from({ length: 12 }, (_, index) => `argument${index}`).join(', ')})`;
    const code = renderMarkdown(`Use \`${codeText}\` here.`).querySelector('code');
    expect(code).toHaveClass(styles.inlineCode ?? '');
    expect(code).toHaveTextContent(codeText);
  });

  test('keeps a source-line-spanning code span inline', () => {
    const code = renderMarkdown('运行 `pnpm test\n--filter shared` 完成。').querySelector('code');
    expect(code).toHaveClass(styles.inlineCode ?? '');
    expect(code).toHaveTextContent('pnpm test --filter shared');
  });

  test('still renders fenced code as a block', () => {
    const container = renderMarkdown('```text\nline one\nline two\n```');
    expect(container.querySelector(`.${styles.codeBlockWrapper ?? ''}`)).not.toBeNull();
    expect(container.querySelector(`.${styles.inlineCode ?? ''}`)).toBeNull();
  });
});

describe('Markdown renderer regressions', () => {
  test('renders standard English Markdown and GFM strikethrough', () => {
    const container = renderMarkdown('**bold**, *italic*, and ~~removed~~.');
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('del')).toHaveTextContent('removed');
  });

  test('does not turn raw HTML into executable script', () => {
    const container = renderMarkdown('<script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
  });

  test('returns no markup for empty content', () => {
    expect(renderMarkdown('')).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// Fable UIUX gap #3: code block copy button + long-code collapse
// ---------------------------------------------------------------------------
describe('code block copy & collapse (fable UIUX #3)', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
  });

  test('renders a copy button on fenced code blocks', () => {
    const container = renderMarkdown('```ts\nconst a = 1;\n```');
    const btn = container.querySelector(`.${styles.codeCopyBtn ?? ''}`);
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain('复制');
  });

  test('clicking copy writes the code and flips to 已复制, then resets', async () => {
    const container = renderMarkdown('```ts\nconst a = 1;\n```');
    const btn = container.querySelector(`.${styles.codeCopyBtn ?? ''}`)!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeTextMock).toHaveBeenCalledWith('const a = 1;');
    expect(btn.textContent).toContain('已复制');
    // 1500ms later the flag resets back to 复制
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(btn.textContent).toContain('复制');
  });

  test('copies blocks without a language tag too', () => {
    const container = renderMarkdown('```\nplain text\nlines\n```');
    const btn = container.querySelector(`.${styles.codeCopyBtn ?? ''}`)!;
    fireEvent.click(btn);
    expect(writeTextMock).toHaveBeenCalledWith('plain text\nlines');
  });

  test('does not offer a collapse toggle for short blocks', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n');
    const container = renderMarkdown('```text\n' + lines + '\n```');
    expect(container.querySelector(`.${styles.codeToggle ?? ''}`)).toBeNull();
    expect(container.querySelector(`.${styles.codeBodyCollapsed ?? ''}`)).toBeNull();
  });

  test('collapses long blocks (>20 lines) with a 展开/收起 toggle', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
    const container = renderMarkdown('```ts\n' + lines + '\n```');
    const toggle = container.querySelector(`.${styles.codeToggle ?? ''}`)!;
    expect(toggle).not.toBeNull();
    // collapsed by default
    expect(container.querySelector(`.${styles.codeBodyCollapsed ?? ''}`)).not.toBeNull();
    expect(toggle.textContent).toContain('展开');
    // expand
    fireEvent.click(toggle);
    expect(container.querySelector(`.${styles.codeBodyCollapsed ?? ''}`)).toBeNull();
    expect(toggle.textContent).toContain('收起');
    // collapse again
    fireEvent.click(toggle);
    expect(container.querySelector(`.${styles.codeBodyCollapsed ?? ''}`)).not.toBeNull();
    expect(toggle.textContent).toContain('展开');
  });
});
