import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeAll } from 'vitest';
import { useTestI18nLanguage } from '../testing/i18n';
import * as XLSX from 'xlsx';
import { MAX_PREVIEW_FILE_BYTES, TablePreview } from './TablePreview';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

/* Size guard tests — defense-in-depth retained after the xlsx migration to
   the official SheetJS source 0.20.3 (issue #1358). Oversized payloads must
   hit the existing error UI without ever reaching XLSX.read; normal-sized
   files must keep parsing as before. */

describe('TablePreview size guard', () => {
  it('refuses files above MAX_PREVIEW_FILE_BYTES via the existing error state', async () => {
    const oversized = new Blob([new Uint8Array(MAX_PREVIEW_FILE_BYTES + 1)]);

    render(<TablePreview fileUrl="/big.xlsx" fileName="big.xlsx" fileBlob={oversized} />);

    expect(await screen.findByText(/文件过大/, undefined, { timeout: 5000 })).toBeInTheDocument();
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
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['a', 'b'],
        ['1', '2'],
      ]),
      'Alpha'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['x', 'y'],
        ['3', '4'],
      ]),
      'Beta'
    );
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

  it('moves the roving stop to the clicked sheet tab (#1823)', async () => {
    render(<TablePreview fileUrl="/two.xlsx" fileName="two.xlsx" fileBlob={twoSheetBlob()} />);
    const alphaTab = await screen.findByRole('tab', { name: 'Alpha' }, { timeout: 15000 });
    const betaTab = screen.getByRole('tab', { name: 'Beta' });

    alphaTab.focus();
    fireEvent.keyDown(alphaTab, { key: 'ArrowRight' });
    expect(betaTab).toHaveAttribute('tabindex', '0');

    // A click activates a sheet — the roving stop must follow it so the next
    // Tab press returns to the clicked sheet, not the stale focused one.
    fireEvent.click(alphaTab);
    expect(alphaTab).toHaveAttribute('tabindex', '0');
    expect(betaTab).toHaveAttribute('tabindex', '-1');
  }, 20000);

  it('uses index-based tab ids so whitespace sheet names keep the tabpanel association (#1823)', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], ['1']]), 'Quarterly Results');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['b'], ['2']]), 'Notes');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([out as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    render(<TablePreview fileUrl="/q.xlsx" fileName="q.xlsx" fileBlob={blob} />);

    const qTab = await screen.findByRole('tab', { name: 'Quarterly Results' }, { timeout: 15000 });
    const panel = screen.getByRole('tabpanel');
    // Ids derive from the stable sheet index — a name with whitespace can
    // never break the aria-labelledby idref list.
    expect(qTab.id).toMatch(/-tab-0$/);
    expect(panel.id).not.toBe('');
    expect(panel.getAttribute('aria-labelledby')).toBe(qTab.id);
    expect(qTab.getAttribute('aria-controls')).toBe(panel.id);
  }, 20000);

  it('falls back to the active sheet when the remembered roving sheet disappears (#1823)', async () => {
    const { rerender } = render(
      <TablePreview fileUrl="/two.xlsx" fileName="two.xlsx" fileBlob={twoSheetBlob()} />
    );
    const alphaTab = await screen.findByRole('tab', { name: 'Alpha' }, { timeout: 15000 });
    const betaTab = screen.getByRole('tab', { name: 'Beta' });
    alphaTab.focus();
    fireEvent.keyDown(alphaTab, { key: 'ArrowRight' });
    expect(betaTab).toHaveAttribute('tabindex', '0');

    // The sheet collection changes: Beta is gone, replaced by Gamma. The
    // remembered roving target dangles — the strip must fall back to the
    // active sheet instead of leaving every tab at tabIndex=-1.
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb2,
      XLSX.utils.aoa_to_sheet([
        ['a', 'b'],
        ['1', '2'],
      ]),
      'Alpha'
    );
    XLSX.utils.book_append_sheet(
      wb2,
      XLSX.utils.aoa_to_sheet([
        ['x', 'y'],
        ['3', '4'],
      ]),
      'Gamma'
    );
    const out2 = XLSX.write(wb2, { type: 'array', bookType: 'xlsx' });
    const blob2 = new Blob([out2 as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    rerender(<TablePreview fileUrl="/three.xlsx" fileName="three.xlsx" fileBlob={blob2} />);

    const gammaTab = await screen.findByRole('tab', { name: 'Gamma' }, { timeout: 15000 });
    const alphaAfter = screen.getByRole('tab', { name: 'Alpha' });
    expect(gammaTab).toHaveAttribute('tabindex', '-1');
    expect(alphaAfter).toHaveAttribute('tabindex', '0');
  }, 20000);

  it('associates the sheet tablist with the table as tabpanel', async () => {
    render(<TablePreview fileUrl="/two.xlsx" fileName="two.xlsx" fileBlob={twoSheetBlob()} />);
    const alphaTab = await screen.findByRole('tab', { name: 'Alpha' }, { timeout: 15000 });
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).not.toBe('');
    expect(alphaTab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(alphaTab.id);
  }, 20000);

  it('sortable column header is a native button — keyboard reachable and operatable', async () => {
    const csv = new Blob([new TextEncoder().encode('name,score\nAlice,90\nBob,81')]);
    render(<TablePreview fileUrl="/sort.csv" fileName="sort.csv" fileBlob={csv} />);

    const nameHeader = await screen.findByText('name', {}, { timeout: 15000 });
    // #1851 review: the sort control is a button inside the th; aria-sort
    // stays on the th, focus/Enter/Space come from the button.
    const th = nameHeader.closest('th')!;
    const sortBtn = nameHeader.closest('button')!;
    expect(sortBtn).not.toBeNull();
    expect(th).toHaveAttribute('aria-sort', 'none');
    expect(th).not.toHaveAttribute('tabindex');

    // Keyboard sort (Enter) same as click: asc sort turns into desc.
    sortBtn.focus();
    expect(document.activeElement).toBe(sortBtn);
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    let cells = screen.getAllByRole('cell').map((c) => c.textContent ?? '');
    expect(cells).toEqual(['Alice', '90', 'Bob', '81']);

    await user.keyboard('{Enter}');
    cells = screen.getAllByRole('cell').map((c) => c.textContent ?? '');
    expect(cells).toEqual(['Bob', '81', 'Alice', '90']);
  }, 20000);

  it('keeps the controlled tabpanel mounted for a multi-sheet empty workbook (#1851 review)', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Sheet1');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Sheet2');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([out as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    render(<TablePreview fileUrl="/empty.xlsx" fileName="empty.xlsx" fileBlob={blob} />);

    const sheet1Tab = await screen.findByRole('tab', { name: 'Sheet1' }, { timeout: 15000 });
    // No headers: the panel must still exist so every tab's aria-controls
    // resolves to a real element.
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).not.toBe('');
    expect(sheet1Tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(sheet1Tab.id);
    expect(panel).toHaveTextContent('空工作表');
  }, 20000);
});
