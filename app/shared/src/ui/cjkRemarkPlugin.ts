/**
 * Keep sentence punctuation outside GFM literal autolinks.
 *
 * The transform is deliberately limited to source-confirmed bare HTTP(S)
 * links. Explicit Markdown links and angle-bracket autolinks may intentionally
 * contain CJK punctuation and must retain their author-supplied destination.
 */

interface MarkdownPosition {
  start: { offset?: number };
  end: { offset?: number };
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: MarkdownPosition;
}

interface MarkdownFile {
  toString(): string;
}

const SENTENCE_BOUNDARY = /[、。，．；：！？｡､…—]/u;

const CJK_PAIRS = new Map<string, string>([
  ['（', '）'],
  ['［', '］'],
  ['｛', '｝'],
  ['【', '】'],
  ['〔', '〕'],
  ['〖', '〗'],
  ['〘', '〙'],
  ['〚', '〛'],
  ['〈', '〉'],
  ['《', '》'],
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
]);

const CJK_CLOSERS = new Set(CJK_PAIRS.values());

function firstUnmatchedCloser(value: string): number {
  const balances = new Map<string, number>();

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!character) continue;

    const closer = CJK_PAIRS.get(character);
    if (closer) {
      balances.set(closer, (balances.get(closer) ?? 0) + 1);
      continue;
    }

    if (!CJK_CLOSERS.has(character)) continue;
    const balance = balances.get(character) ?? 0;
    if (balance === 0) return index;
    balances.set(character, balance - 1);
  }

  return -1;
}

function firstAutolinkBoundary(url: string): number {
  const sentenceBoundary = url.search(SENTENCE_BOUNDARY);
  const unmatchedCloser = firstUnmatchedCloser(url);

  if (sentenceBoundary < 0) return unmatchedCloser;
  if (unmatchedCloser < 0) return sentenceBoundary;
  return Math.min(sentenceBoundary, unmatchedCloser);
}

function fixLiteralAutolinks(children: MarkdownNode[], source: string): void {
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (!node) continue;

    const linkText = node.children?.length === 1 ? node.children[0] : undefined;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const url = node.url;

    if (
      node.type === 'link' &&
      linkText?.type === 'text' &&
      typeof url === 'string' &&
      linkText.value === url &&
      /^https?:\/\//iu.test(url) &&
      typeof start === 'number' &&
      typeof end === 'number' &&
      source.slice(start, end) === url
    ) {
      const boundary = firstAutolinkBoundary(url);
      if (boundary > 0) {
        const trailingText = url.slice(boundary);
        node.url = url.slice(0, boundary);
        linkText.value = node.url;
        children.splice(index + 1, 0, { type: 'text', value: trailingText });
        index += 1;
      }
    }

    if (node.children) fixLiteralAutolinks(node.children, source);
  }
}

export default function remarkCjkAutolink() {
  return (tree: MarkdownNode, file: MarkdownFile) => {
    if (tree.children) fixLiteralAutolinks(tree.children, file.toString());
  };
}
