/* ═══════════════════════════════════════════════════════════════════════
   TablePreview — Browser-side .xlsx / .xls / .csv renderer using SheetJS

   Props:
     fileUrl   — URL to fetch the spreadsheet file from
     fileName  — Display name shown in the header
     fileBlob  — Optional pre-fetched Blob (skips fetch)
     onClose   — Called when the close button is clicked

   Fetches the file, parses via XLSX.read (dynamic import — lazy-loaded
   to keep ~1 MB xlsx out of the main bundle), and renders as a
   scrollable HTML table with sortable columns.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useId, useRef, useState, useEffect, useMemo } from 'react';
import { AlertCircle, ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, X } from 'lucide-react';
import { Button } from './Button';
import styles from './TablePreview.module.css';
import { Tooltip } from './Tooltip';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

export interface TablePreviewProps {
  fileUrl: string;
  fileName: string;
  fileBlob?: Blob | undefined;
  onClose?: (() => void) | undefined;
}

type SortDirection = 'asc' | 'desc' | null;

interface SortState {
  column: number;
  direction: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════
// Lazy xlsx module loader — dynamic import keeps ~1 MB out of main bundle
// ═══════════════════════════════════════════════════════════════════════

let xlsxModule: typeof import('xlsx') | null = null;

async function getXLSX(): Promise<typeof import('xlsx')> {
  if (!xlsxModule) {
    xlsxModule = await import('xlsx');
  }
  return xlsxModule;
}

// ═══════════════════════════════════════════════════════════════════════
// Preview size guard — defense-in-depth for the SheetJS parser.
// Originally added while xlsx@0.18.5 (npm, unpatched prototype pollution /
// ReDoS advisories) was in use; xlsx now tracks the official SheetJS CDN
// source (0.20.3, all known advisories fixed — issue #1358). The guard is
// retained: it caps the bytes handed to XLSX.read so an attacker-controlled
// download cannot feed unbounded input to the parser, and it runs BEFORE
// the lazy xlsx import, so oversized files never even load the parser chunk.
// ═══════════════════════════════════════════════════════════════════════

export const MAX_PREVIEW_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

function assertPreviewSizeAllowed(byteLength: number): void {
  if (byteLength > MAX_PREVIEW_FILE_BYTES) {
    const actualMb = (byteLength / (1024 * 1024)).toFixed(1);
    const limitMb = MAX_PREVIEW_FILE_BYTES / (1024 * 1024);
    throw new Error(`文件过大（${actualMb} MB，上限 ${limitMb} MB），出于安全限制不预览`);
  }
}

export const TablePreview: React.FC<TablePreviewProps> = ({
  fileUrl,
  fileName,
  fileBlob,
  onClose,
}) => {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ column: -1, direction: null });
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');

  const parseSheet = useCallback((workbook: import('xlsx').WorkBook, sheetName: string) => {
    const XLSX = xlsxModule!;
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;

    const data: string[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    const firstRow = data[0];
    if (!firstRow) {
      setHeaders([]);
      setRows([]);
      setRawRows([]);
      return;
    }

    const headerRow = firstRow.map(String);
    const dataRows = data.slice(1).map((row) => row.map(String));

    setHeaders(headerRow);
    setRawRows(dataRows);
    setRows(dataRows);
    setSort({ column: -1, direction: null });
  }, []);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHeaders([]);
    setRows([]);
    setRawRows([]);

    try {
      let arrayBuffer: ArrayBuffer;

      if (fileBlob) {
        arrayBuffer = await fileBlob.arrayBuffer();
      } else {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
      }

      assertPreviewSizeAllowed(arrayBuffer.byteLength);

      const XLSX = await getXLSX();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const names = workbook.SheetNames;
      setSheetNames(names);

      const sheetName = names[0];
      if (!sheetName) {
        throw new Error('No sheets found in workbook');
      }
      setActiveSheet(sheetName);
      parseSheet(workbook, sheetName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error parsing spreadsheet';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fileUrl, fileBlob, parseSheet]);

  useEffect(() => {
    loadFile().catch((err) => {
      console.error('TablePreview: loadFile failed:', err);
    });
  }, [loadFile]);

  const handleSort = useCallback(
    (colIndex: number) => {
      setSort((prev) => {
        let newDirection: SortDirection;
        if (prev.column !== colIndex) {
          newDirection = 'asc';
        } else if (prev.direction === 'asc') {
          newDirection = 'desc';
        } else if (prev.direction === 'desc') {
          newDirection = null;
        } else {
          newDirection = 'asc';
        }

        if (newDirection === null) {
          setRows(rawRows);
        } else {
          setRows((prevRows) =>
            [...prevRows].sort((a, b) => {
              const valA = a[colIndex] ?? '';
              const valB = b[colIndex] ?? '';
              const cmp = valA.localeCompare(valB, undefined, { numeric: true });
              return newDirection === 'asc' ? cmp : -cmp;
            })
          );
        }

        return { column: colIndex, direction: newDirection };
      });
    },
    [rawRows]
  );

  const handleSheetSwitch = useCallback(
    (sheetName: string) => {
      setActiveSheet(sheetName);
      if (fileBlob) {
        /* Re-parse from the same blob — we already have it loaded */
        fileBlob
          .arrayBuffer()
          .then(async (ab) => {
            assertPreviewSizeAllowed(ab.byteLength);
            const XLSX = await getXLSX();
            const wb = XLSX.read(ab, { type: 'array' });
            parseSheet(wb, sheetName);
          })
          .catch((err) => {
            console.error('TablePreview: sheet switch (blob) failed:', sheetName, err);
          });
      } else {
        fetch(fileUrl)
          .then((response) => {
            if (!response.ok) {
              console.error(
                'TablePreview: sheet switch fetch failed:',
                response.status,
                response.statusText
              );
              return;
            }
            response
              .arrayBuffer()
              .then(async (ab) => {
                assertPreviewSizeAllowed(ab.byteLength);
                const XLSX = await getXLSX();
                const wb = XLSX.read(ab, { type: 'array' });
                parseSheet(wb, sheetName);
              })
              .catch((err) => {
                console.error(
                  'TablePreview: sheet switch (fetch→arrayBuffer) failed:',
                  sheetName,
                  err
                );
              });
          })
          .catch((err) => {
            console.error('TablePreview: sheet switch fetch failed:', sheetName, err);
          });
      }
    },
    [fileBlob, fileUrl, parseSheet]
  );

  const sortIcon = useMemo(() => {
    return (colIndex: number) => {
      if (sort.column !== colIndex || sort.direction === null) {
        return <ArrowUpDown size={12} className={styles.sortIcon} />;
      }
      return sort.direction === 'asc' ? (
        <ArrowUp size={12} className={styles.sortIconActive} />
      ) : (
        <ArrowDown size={12} className={styles.sortIconActive} />
      );
    };
  }, [sort]);

  const fileExt = fileName.split('.').pop()?.toUpperCase() ?? '';

  // ── Roving tabindex for the sheet tablist (#1823) ────────────────────
  // One Tab stop for the strip; Arrow/Home/End move focus between sheet
  // tabs without switching the sheet (activation stays on click/Enter,
  // matching the #1835 TerminalPanel pattern).
  const sheetTabsRef = useRef<HTMLDivElement>(null);
  const sheetTabsId = useId();
  const [rovingSheetId, setRovingSheetId] = useState<string | null>(null);

  // #1823: tab/panel ARIA ids use the stable sheet index — worksheet names
  // can contain whitespace, which would break aria-labelledby idrefs.
  const activeSheetIndex = sheetNames.indexOf(activeSheet);

  const handleSheetTabsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabButtons = sheetTabsRef.current
      ? Array.from(sheetTabsRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      : [];
    if (tabButtons.length === 0) return;
    const activeIndex = tabButtons.findIndex((button) => button === document.activeElement);
    // Focus outside the tab strip (e.g. the close button): arrow keys own
    // the strip only, do not hijack other controls (#1835 review).
    if (activeIndex < 0) return;
    let nextIndex: number | null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (activeIndex + 1) % tabButtons.length;
        break;
      case 'ArrowLeft':
        nextIndex = (activeIndex - 1 + tabButtons.length) % tabButtons.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabButtons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabButtons[nextIndex];
    target?.focus();
    setRovingSheetId(target?.dataset.sheetName ?? null);
  }, []);

  return (
    <section className={styles.root} aria-label={`${fileName} spreadsheet preview`}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={styles.fileName} title={fileName}>
            {fileName}
          </span>
          <span className={styles.badge}>{fileExt}</span>
        </div>
        {onClose && (
          <Tooltip label={t('aria.closePreview')}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={onClose}
              aria-label={t('aria.closePreview')}
            >
              <X size={16} />
            </Button>
          </Tooltip>
        )}
      </div>

      {/* ── Sheet tabs ── */}
      {sheetNames.length > 1 && (
        <div
          className={styles.sheetTabs}
          role="tablist"
          aria-label={t('aria.worksheet')}
          ref={sheetTabsRef}
          onKeyDown={handleSheetTabsKeyDown}
        >
          {sheetNames.map((name, sheetIndex) => {
            const selected = name === activeSheet;
            // #1823: a remembered roving target can dangle after the sheet
            // collection changes — fall back to the active sheet so the
            // strip always keeps exactly one Tab stop.
            const rovingValid = rovingSheetId !== null && sheetNames.includes(rovingSheetId);
            const isTabStop = name === (rovingValid ? rovingSheetId : activeSheet);
            return (
              <button
                key={name}
                role="tab"
                type="button"
                id={`${sheetTabsId}-tab-${sheetIndex}`}
                aria-controls={`${sheetTabsId}-panel`}
                aria-selected={selected}
                tabIndex={isTabStop ? 0 : -1}
                className={`${styles.sheetTab} ${selected ? styles.sheetTabActive : ''}`}
                data-sheet-name={name}
                onClick={() => {
                  // #1823: click activation switches the sheet AND moves the
                  // roving stop to it — otherwise Tab later returns to the
                  // stale stop.
                  setRovingSheetId(name);
                  handleSheetSwitch(name);
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('preview.parsing')}</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className={styles.error}>
          <AlertCircle size={28} className={styles.errorIcon} />
          <span className={styles.errorMessage}>{error}</span>
          <button className={styles.retryBtn} onClick={loadFile} type="button">
            <RotateCcw size={14} />
            <span>{t('preview.retry')}</span>
          </button>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && !error && (headers.length > 0 || sheetNames.length > 1) && (
        <div
          className={styles.tableWrapper}
          role="tabpanel"
          id={`${sheetTabsId}-panel`}
          aria-labelledby={
            sheetNames.length > 1 && activeSheetIndex >= 0
              ? `${sheetTabsId}-tab-${activeSheetIndex}`
              : undefined
          }
        >
          {headers.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  {headers.map((header, i) => (
                    <th
                      key={i}
                      className={styles.th}
                      aria-sort={
                        sort.column === i
                          ? sort.direction === 'asc'
                            ? 'ascending'
                            : sort.direction === 'desc'
                              ? 'descending'
                              : 'none'
                          : 'none'
                      }
                    >
                      {/* #1851 review: the sortable header is a native button —
                        th+tabIndex+onKeyDown exposed no interactive control
                        to AT; Enter/Space activation and focusability now
                        come from the button, aria-sort stays on the th. */}
                      <button type="button" className={styles.thBtn} onClick={() => handleSort(i)}>
                        <span className={styles.thContent}>
                          <span className={styles.thText}>{header || `Column ${i + 1}`}</span>
                          {sortIcon(i)}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className={styles.tr}>
                    {row.map((cell, ci) => (
                      <td key={ci} className={styles.td} title={cell}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            /* #1851 review: multi-sheet empty workbooks still mount the
             controlled tabpanel so the tabs' aria-controls resolves. */
            <div className={styles.emptySheet}>
              <span>{t('preview.emptySheet')}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      {!loading && !error && (
        <div className={styles.footer}>
          <span>{rows.length} 行</span>
          {headers.length > 0 && <span>{headers.length} 列</span>}
          {sheetNames.length > 1 && <span>{sheetNames.length} 个工作表</span>}
        </div>
      )}
    </section>
  );
};
