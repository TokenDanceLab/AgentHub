import { act, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import MarkdownContent from './Markdown';
import styles from './Markdown.module.css';

// CodeBlock (rendered by Markdown) resolves copy/expand labels via the
// chatview namespace; opt into the zh bundle of the shared test i18next
// instance (Issue #1717).
import { useTestI18nLanguage } from '../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

// jsdom cannot compute stylesheet rules under vitest's default css:false
// (module CSS exports class names only; the styles never reach the
// document), so rules that only matter visually are asserted as a
// CSS-contract test against the module source (same pattern as
// chatview/components/Transcript.css.test.ts).
const markdownCss = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'Markdown.module.css'),
  'utf8',
);

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

  test('does not render an inline <img onerror> hidden inside emphasis as a real image', () => {
    // react-markdown without rehype-raw treats raw HTML as literal text, so
    // an adversarial `**<img src=x onerror=alert(1)>**` must NOT produce a
    // real <img> element nor attach an onerror attribute anywhere.
    const container = renderMarkdown('**<img src=x onerror=alert(1)>**');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong')).not.toBeNull();
    // No element in the rendered tree carries an onerror attribute.
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  test('treats a bare <img onerror> payload as text, not an element', () => {
    const container = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  test('returns no markup for empty content', () => {
    expect(renderMarkdown('')).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// Heading anchor links (#1506)
// ---------------------------------------------------------------------------
describe('heading anchors (rehype-slug, #1506)', () => {
  test('adds a GitHub-style slug id to headings', () => {
    const container = renderMarkdown('## Hello World');
    expect(container.querySelector('h2')).toHaveAttribute('id', 'hello-world');
  });

  test('keeps CJK characters in heading slugs', () => {
    const container = renderMarkdown('## 重要标题');
    expect(container.querySelector('h2')).toHaveAttribute('id', '重要标题');
  });

  test('appends -1/-2 suffixes to duplicate headings', () => {
    const container = renderMarkdown('## 标题\n## 标题\n## 标题');
    const ids = Array.from(container.querySelectorAll('h2')).map((h) => h.getAttribute('id'));
    expect(ids).toEqual(['标题', '标题-1', '标题-2']);
  });

  test('renders a hover link icon anchored to the heading slug', () => {
    const container = renderMarkdown('## Section One');
    const heading = container.querySelector('h2');
    const link = heading?.querySelector(`a.${styles.headingAnchor ?? ''}`);
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '#section-one');
    expect(link).toHaveAttribute('aria-label', '跳转到标题');
  });

  test('covers all heading levels h1-h6', () => {
    const container = renderMarkdown('# A\n## B\n### C\n#### D\n##### E\n###### F');
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const heading = container.querySelector(`h${level}`);
      expect(heading).not.toBeNull();
      expect(heading!.querySelector('a')).not.toBeNull();
    }
  });

  test('anchor click target resolves to a real heading id', () => {
    // jsdom cannot perform fragment navigation on click, so assert the
    // contract that makes the native jump work: href equals the heading id
    // that exists in the same document (real browsers then scroll to it).
    const container = renderMarkdown('## Target');
    const link = container.querySelector('h2 a')!;
    const href = link.getAttribute('href');
    expect(href).toBe('#target');
    const target = href ? container.querySelector(`#${href.slice(1)}`) : null;
    expect(target).not.toBeNull();
    expect(target!.tagName).toBe('H2');
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

// ---------------------------------------------------------------------------
// Fable UIUX: markdown links & images (codeg parity)
// ---------------------------------------------------------------------------
describe('markdown links & images (codeg parity)', () => {
  test('renders images with loading="lazy"', () => {
    const container = renderMarkdown('![alt text](https://example.com/img.png)');
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.com/img.png');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('alt', 'alt text');
  });

  test('opens external links in a new tab with noopener noreferrer', () => {
    const container = renderMarkdown('[docs](https://example.com/guide)');
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', 'https://example.com/guide');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('keeps in-page anchor links in the same window', () => {
    const container = renderMarkdown('[jump](#section-1)');
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', '#section-1');
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });
});

// ---------------------------------------------------------------------------
// Fable UIUX: GFM task lists + sticky table header (codeg parity)
// ---------------------------------------------------------------------------
describe('GFM task lists (codeg parity)', () => {
  test('renders checkboxes with contains-task-list / task-list-item classes', () => {
    const container = renderMarkdown('- [x] 已完成\n- [ ] 待办事项');
    expect(container.querySelector('ul.contains-task-list')).not.toBeNull();
    const items = container.querySelectorAll('li.task-list-item');
    expect(items).toHaveLength(2);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toHaveAttribute('checked');
    expect(checkboxes[0]).toHaveAttribute('disabled');
    expect(checkboxes[1]).not.toHaveAttribute('checked');
  });

  test('strikes through and dims checked items', () => {
    expect(markdownCss).toMatch(/li\.task-list-item:has\(> input\[type='checkbox'\]:checked\)/);
    expect(markdownCss).toMatch(/text-decoration:\s*line-through;/);
    expect(markdownCss).toMatch(/opacity:\s*0\.6;/);
  });
});

describe('markdown table header stickiness (codeg parity)', () => {
  test('pins the header row while the table scrolls', () => {
    const container = renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |');
    expect(container.querySelector('thead th')).not.toBeNull();
    const thRule = markdownCss.match(/\.root th\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
    expect(thRule).toMatch(/position:\s*sticky;/);
    expect(thRule).toMatch(/top:\s*0;/);
    expect(thRule).toMatch(/z-index:\s*1;/);
  });
});
