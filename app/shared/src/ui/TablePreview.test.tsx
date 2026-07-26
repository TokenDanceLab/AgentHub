import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MAX_PREVIEW_FILE_BYTES, TablePreview } from './TablePreview';

/* Size guard tests — mitigation for unpatched xlsx@0.18.5 (issue #1358).
   Oversized payloads must hit the existing error UI without ever reaching
   XLSX.read; normal-sized files must keep parsing as before. */

describe('TablePreview size guard', () => {
  it('refuses files above MAX_PREVIEW_FILE_BYTES via the existing error state', async () => {
    const oversized = new Blob([new Uint8Array(MAX_PREVIEW_FILE_BYTES + 1)]);

    render(<TablePreview fileUrl="/big.xlsx" fileName="big.xlsx" fileBlob={oversized} />);

    expect(
      await screen.findByText(/文件过大/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    /* Existing error branch: retry button rendered, no table. */
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('still parses files below the limit', async () => {
    const csv = new Blob([new TextEncoder().encode('name,score\nAlice,90\nBob,81')]);

    render(<TablePreview fileUrl="/small.csv" fileName="small.csv" fileBlob={csv} />);

    /* First xlsx dynamic import can be slow under vitest — generous timeout. */
    expect(await screen.findByText('Alice', undefined, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.queryByText(/文件过大/)).not.toBeInTheDocument();
  }, 20000);
});
