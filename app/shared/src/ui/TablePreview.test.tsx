import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MAX_PREVIEW_FILE_BYTES, TablePreview } from './TablePreview';

/* Size guard tests — defense-in-depth retained after the xlsx migration to
   the official SheetJS source 0.20.3 (issue #1358). Oversized payloads must
   hit the existing error UI without ever reaching XLSX.read; normal-sized
   files must keep parsing as before. */

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

describe('TablePreview #1823 keyboard accessibility', () => {
  function twoSheetBlob(): Blob {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['a', 'b'], ['1', '2']]), 'Alpha');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['x', 'y'], ['3', '4']]), 'Beta');
    const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    return new Blob([out as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  it('roving tabindex on the sheet tab list — arrows move focus without switching sheets', async () => {
    render(<TablePreview fileUrl="/two.xlsx" fileName="two.xlsx" fileBlob={twoSheetBlob()} />);

    const alphaTab = await screen.findByRole('tab', { name: 'Alpha' }, { timeout: 15000 });
    const betaTab = screen.getByRole('tab', { name: 'Beta' });

    // Single Tab stop owned by the selected sheet.
    expect(alphaTab).toHaveAttribute('tabindex', '0');
    expect(betaTab).toHaveAttribute('tabindex', '-1');

    alphaTab.focus();
    fireEvent.keyDown(alphaTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(betaTab);
    expect(betaTab).toHaveAttribute('tabindex', '0');
    expect(alphaTab).toHaveAttribute('tabindex', '-1');
    // Activation stays on click/Enter — sheet content unchanged.
    expect(alphaTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('1')).toBeInTheDocument();

    fireEvent.keyDown(betaTab, { key: 'Home' });
    expect(document.activeElement).toBe(alphaTab);

    fireEvent.keyDown(alphaTab, { key: 'End' });
    expect(document.activeElement).toBe(betaTab);
  }, 20000);

  it('associates the sheet tablist with the table as tabpanel', async () => {
    render(<TablePreview fileUrl="/two.xlsx" fileName="two.xlsx" fileBlob={twoSheetBlob()} />);
    const alphaTab = await screen.findByRole('tab', { name: 'Alpha' }, { timeout: 15000 });
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).not.toBe('');
    expect(alphaTab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(alphaTab.id);
  }, 20000);

  it('sortable column header is keyboard reachable and operatable', async () => {
    const csv = new Blob([new TextEncoder().encode('name,score\nAlice,90\nBob,81')]);
    render(<TablePreview fileUrl="/sort.csv" fileName="sort.csv" fileBlob={csv} />);

    const nameHeader = await screen.findByText('name', {}, { timeout: 15000 });
    const th = nameHeader.closest('th')!;
    expect(th).toHaveAttribute('tabindex', '0');

    // Keyboard sort (Enter) same as click: asc sort turns into desc.
    th.focus();
    fireEvent.keyDown(th, { key: 'Enter' });
    let cells = screen.getAllByRole('cell').map((c) => c.textContent ?? '');
    expect(cells).toEqual(['Alice', '90', 'Bob', '81']);

    fireEvent.keyDown(th, { key: 'Enter' });
    cells = screen.getAllByRole('cell').map((c) => c.textContent ?? '');
    expect(cells).toEqual(['Bob', '81', 'Alice', '90']);
  }, 20000);
});
