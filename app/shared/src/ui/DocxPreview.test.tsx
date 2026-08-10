import { describe, it, expect, vi } from 'vitest';
import { render, findByText } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

// Mock mammoth so we control the raw HTML it "produces" — this lets us feed
// adversarial markup (inline style CSS injection, script tags) and assert
// the DOMPurify config in DocxPreview strips them. dompurify itself is NOT
// mocked — we exercise the real sanitizer with the component's config.
vi.mock('mammoth', () => ({
  default: {
    convertToHtml: async () => ({
      value:
        '<p>hello</p>' +
        '<span style="background-image:url(javascript:alert(1));color:red">styled</span>' +
        '<script>alert(1)</script>' +
        '<img src="x" onerror="alert(1)" alt="bad">',
      messages: [],
    }),
  },
}));

import { DocxPreview } from './DocxPreview';

/** Minimal Blob stub: the component only calls .arrayBuffer() on fileBlob. */
function makeBlob(): Blob {
  const blob = { arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Blob;
  return blob;
}

async function renderDocx() {
  const result = render(
    <DocxPreview fileUrl="https://example.com/doc.docx" fileName="doc.docx" fileBlob={makeBlob()} />,
  );
  return result;
}

describe('DocxPreview XSS hardening', () => {
  it('strips inline style attributes (CSS injection surface) from mammoth output', async () => {
    const { container } = await renderDocx();
    await findByText(container, 'styled');

    // The span survives (span is in ALLOWED_TAGS) but its style attribute
    // MUST be gone — style was removed from ALLOWED_ATTR. Assert no element
    // in the rendered output carries a style attribute at all.
    const styledElements = container.querySelectorAll('[style]');
    expect(styledElements.length).toBe(0);
    expect(container.textContent).toContain('styled');
  });

  it('strips script tags and img onerror handlers', async () => {
    const { container } = await renderDocx();
    await findByText(container, 'hello');

    expect(container.querySelector('script')).toBeNull();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.hasAttribute('onerror')).toBe(false);
    // src is allowed (img + src in allowlist) so it stays.
    expect(img?.getAttribute('src')).toBe('x');
  });
});

describe('DocxPreview rendering', () => {
  it('renders the header with the file name and DOCX badge', async () => {
    const { container } = await renderDocx();
    expect(await findByText(container, 'doc.docx')).toBeInTheDocument();
    expect(await findByText(container, 'DOCX')).toBeInTheDocument();
  });
});
