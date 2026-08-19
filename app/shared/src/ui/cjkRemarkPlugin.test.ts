// real_tested=true
import { describe, expect, it } from 'vitest';
import remarkCjkAutolink from './cjkRemarkPlugin';

interface FakeNode {
  type: string;
  value?: string;
  url?: string;
  children?: FakeNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

function textNode(value: string): FakeNode {
  return { type: 'text', value };
}

function autolinkNode(url: string, startOffset: number, endOffset: number): FakeNode {
  return {
    type: 'link',
    url,
    position: { start: { offset: startOffset }, end: { offset: endOffset } },
    children: [textNode(url)],
  };
}

/** A link whose text differs from its url — an explicit Markdown link. */
function explicitLinkNode(url: string): FakeNode {
  return { type: 'link', url, children: [textNode('docs')] };
}

function paragraph(children: FakeNode[]): FakeNode {
  return { type: 'paragraph', children };
}

function runTransform(tree: FakeNode, source: string): void {
  remarkCjkAutolink()(tree, { toString: () => source });
}

describe('remarkCjkAutolink', () => {
  it('leaves a bare http url without trailing punctuation untouched', () => {
    const url = 'https://example.com/foo';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);
    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.url).toBe(url);
  });

  it('splits a trailing CJK full stop out of a bare url', () => {
    const url = 'https://example.com/foo。';
    const link = autolinkNode(url, 0, url.length);
    const tree = paragraph([link]);
    runTransform(tree, url);

    expect(tree.children).toHaveLength(2);
    expect(tree.children?.[0]?.url).toBe('https://example.com/foo');
    expect(tree.children?.[0]?.children?.[0]?.value).toBe('https://example.com/foo');
    expect(tree.children?.[1]).toEqual({ type: 'text', value: '。' });
  });

  it('splits a trailing CJK comma out of a bare url', () => {
    const url = 'https://example.com/foo，';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);

    expect(tree.children?.[0]?.url).toBe('https://example.com/foo');
    expect(tree.children?.[1]).toEqual({ type: 'text', value: '，' });
  });

  it('splits a trailing exclamation mark out of a bare url', () => {
    const url = 'https://example.com/foo！';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);

    expect(tree.children?.[0]?.url).toBe('https://example.com/foo');
    expect(tree.children?.[1]).toEqual({ type: 'text', value: '！' });
  });

  it('keeps balanced CJK bracket pairs inside the url', () => {
    const url = 'https://example.com/（foo）';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);

    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.url).toBe(url);
  });

  it('splits an unmatched CJK closing bracket out of the url', () => {
    const url = 'https://example.com/foo）';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);

    expect(tree.children?.[0]?.url).toBe('https://example.com/foo');
    expect(tree.children?.[1]).toEqual({ type: 'text', value: '）' });
  });

  it('splits at the earlier of the sentence boundary and an unmatched closer', () => {
    const url = 'https://example.com/foo）bar。';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);

    expect(tree.children?.[0]?.url).toBe('https://example.com/foo');
    expect(tree.children?.[1]).toEqual({ type: 'text', value: '）bar。' });
  });

  it('leaves explicit markdown links untouched', () => {
    const url = 'https://example.com/foo。';
    const link = explicitLinkNode(url);
    const tree = paragraph([link]);
    runTransform(tree, url);

    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.url).toBe(url);
  });

  it('ignores non-http(s) urls', () => {
    const url = 'ftp://example.com/foo。';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);

    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.url).toBe(url);
  });

  it('ignores links without position offsets', () => {
    const url = 'https://example.com/foo。';
    const link: FakeNode = { type: 'link', url, children: [textNode(url)] };
    const tree = paragraph([link]);
    runTransform(tree, url);

    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.url).toBe(url);
  });

  it('ignores links whose source slice no longer matches the url', () => {
    const url = 'https://example.com/foo。';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, 'https://different.example/foo。');

    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.url).toBe(url);
  });

  it('recurses into nested nodes such as blockquotes', () => {
    const url = 'https://example.com/foo。';
    const tree: FakeNode = {
      type: 'blockquote',
      children: [paragraph([autolinkNode(url, 0, url.length)])],
    };
    runTransform(tree, url);

    const paragraphChildren = tree.children?.[0]?.children;
    expect(paragraphChildren).toHaveLength(2);
    expect(paragraphChildren?.[0]?.url).toBe('https://example.com/foo');
    expect(paragraphChildren?.[1]).toEqual({ type: 'text', value: '。' });
  });

  it('splits each of multiple autolinks in the same paragraph', () => {
    const firstUrl = 'https://a.com/1。';
    const secondUrl = 'https://b.com/2。';
    const source = firstUrl + secondUrl;
    const tree = paragraph([
      autolinkNode(firstUrl, 0, firstUrl.length),
      autolinkNode(secondUrl, firstUrl.length, source.length),
    ]);
    runTransform(tree, source);

    expect(tree.children).toHaveLength(4);
    expect(tree.children?.[0]?.url).toBe('https://a.com/1');
    expect(tree.children?.[1]).toEqual({ type: 'text', value: '。' });
    expect(tree.children?.[2]?.url).toBe('https://b.com/2');
    expect(tree.children?.[3]).toEqual({ type: 'text', value: '。' });
  });

  it('splits at an unmatched closer in the middle of the url', () => {
    const url = 'https://example.com/foo）bar';
    const tree = paragraph([autolinkNode(url, 0, url.length)]);
    runTransform(tree, url);

    expect(tree.children?.[0]?.url).toBe('https://example.com/foo');
    expect(tree.children?.[1]).toEqual({ type: 'text', value: '）bar' });
  });

  it('leaves links with multiple text children untouched', () => {
    const url = 'https://example.com/foo。';
    const link: FakeNode = {
      type: 'link',
      url,
      position: { start: { offset: 0 }, end: { offset: url.length } },
      children: [textNode('https://example.com/foo'), textNode('。')],
    };
    const tree = paragraph([link]);
    runTransform(tree, url);

    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.url).toBe(url);
  });

  it('handles trees without children without throwing', () => {
    expect(() => runTransform({ type: 'root' }, 'https://example.com')).not.toThrow();
  });

  it('leaves non-link nodes untouched', () => {
    const tree: FakeNode = {
      type: 'paragraph',
      children: [textNode('plain text with no links')],
    };
    const snapshot = JSON.stringify(tree);
    runTransform(tree, 'plain text with no links');
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});
