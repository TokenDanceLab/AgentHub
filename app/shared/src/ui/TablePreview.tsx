/* ═══════════════════════════════════════════════════════════════════════
   TablePreview — Browser-side .xlsx / .xls / .csv renderer using SheetJS

   Props:
     fileUrl   — URL to fetch the spreadsheet file from
     fileName  — Display name shown in the header
     fileBlob  — Optional pre-fetched Blob (skips fetch)
     onClose   — Called when the close button is clicked

   Fetches the file, parses via XLSX.read, and renders as a scrollable
   HTML table with sortable columns.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertCircle, ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import styles from './TablePreview.module.css';

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

export const TablePreview: React.FC<TablePreviewProps> = ({
  fileUrl,
  fileName,
  fileBlob,
  onClose,
}) => {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ column: -1, direction: null });
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');

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
  }, [fileUrl, fileBlob]);

  function parseSheet(workbook: XLSX.WorkBook, sheetName: string): void {
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
  }

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleSort = useCallback((colIndex: number) => {
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
          }),
        );
      }

      return { column: colIndex, direction: newDirection };
    });
  }, [rawRows]);

  const handleSheetSwitch = useCallback((sheetName: string) => {
    setActiveSheet(sheetName);
    try {
      let arrayBuffer: ArrayBuffer;
      if (fileBlob) {
        /* Re-parse from the same blob — we already have it loaded */
        void fileBlob.arrayBuffer().then((ab) => {
          const wb = XLSX.read(ab, { type: 'array' });
          parseSheet(wb, sheetName);
        });
      } else {
        void fetch(fileUrl).then((response) => {
          if (!response.ok) return;
          void response.arrayBuffer().then((ab) => {
            const wb = XLSX.read(ab, { type: 'array' });
            parseSheet(wb, sheetName);
          });
        });
      }
    } catch {
      /* Ignore sheet switch errors */
    }
  }, [fileBlob, fileUrl]);

  const sortIcon = useMemo(() => {
    return (colIndex: number) => {
      if (sort.column !== colIndex || sort.direction === null) {
        return <ArrowUpDown size={12} className={styles.sortIcon} />;
      }
      return sort.direction === 'asc'
        ? <ArrowUp size={12} className={styles.sortIconActive} />
        : <ArrowDown size={12} className={styles.sortIconActive} />;
    };
  }, [sort]);

  const fileExt = fileName.split('.').pop()?.toUpperCase() ?? '';

  return (
    <section className={styles.root} aria-label={`${fileName} spreadsheet preview`}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={styles.fileName} title={fileName}>{fileName}</span>
          <span className={styles.badge}>{fileExt}</span>
        </div>
        {onClose && (
          <button
            className={styles.closeBtn}
            type="button"
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭预览"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* ── Sheet tabs ── */}
      {sheetNames.length > 1 && (
        <div className={styles.sheetTabs} role="tablist" aria-label="工作表">
          {sheetNames.map((name) => (
            <button
              key={name}
              role="tab"
              type="button"
              aria-selected={name === activeSheet}
              className={`${styles.sheetTab} ${name === activeSheet ? styles.sheetTabActive : ''}`}
              onClick={() => handleSheetSwitch(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>正在解析表格...</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className={styles.error}>
          <AlertCircle size={28} className={styles.errorIcon} />
          <span className={styles.errorMessage}>{error}</span>
          <button className={styles.retryBtn} onClick={loadFile} type="button">
            <RotateCcw size={14} />
            <span>重试</span>
          </button>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && !error && headers.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {headers.map((header, i) => (
                  <th
                    key={i}
                    className={styles.th}
                    onClick={() => handleSort(i)}
                    role="columnheader"
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
                    <span className={styles.thContent}>
                      <span className={styles.thText}>{header || `Column ${i + 1}`}</span>
                      {sortIcon(i)}
                    </span>
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
