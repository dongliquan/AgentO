import { useMemo, useState } from 'react';
import { compareCells, detectDelimiter, parseDelimited } from '@/lib/csv';

const MAX_ROWS = 2000;

export function CsvTable({ content, ext }: { content: string; ext: string }): JSX.Element {
  const rows = useMemo(() => parseDelimited(content, detectDelimiter(content, ext)), [content, ext]);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  const header = rows[0] ?? [];
  const body = useMemo(() => {
    const b = rows.slice(1);
    if (!sort) return b;
    const { col, dir } = sort;
    return [...b].sort((a, c) => dir * compareCells(a[col] ?? '', c[col] ?? ''));
  }, [rows, sort]);

  if (rows.length === 0) return <div className="tree-empty">Empty file</div>;

  const toggle = (col: number): void => {
    setSort((prev) => (prev && prev.col === col ? (prev.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
  };

  return (
    <>
      {body.length > MAX_ROWS && <div className="diff-note">Showing {MAX_ROWS} of {body.length} rows</div>}
      <table className="csv">
        <thead>
          <tr>
            <th className="muted">#</th>
            {header.map((h, i) => (
              <th key={i} onClick={() => toggle(i)}>
                {h || `Column ${i + 1}`} {sort?.col === i ? (sort.dir === 1 ? '▲' : '▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, MAX_ROWS).map((r, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              {header.map((_h, j) => (
                <td key={j}>{r[j] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
