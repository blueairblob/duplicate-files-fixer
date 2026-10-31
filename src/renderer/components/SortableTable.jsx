import React, { useState, useEffect } from 'react';
import { nextSort } from '../utils/sortRows.js';

const PAGE = 500; // rows rendered per "show more"

// `s` supplies table, th, thBtn, td, rtl and btn styles (see makeTableStyles).
// Sortable table with a sticky header, rendered PAGE rows at a time.
// `resetKey` changes when the list or its sort changes, and starts paging over.
export default function SortableTable({ columns, rows, sort, onSort, rowKey, caption, resetKey, s, scale }) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [resetKey]);
  const shown = rows.slice(0, limit);
  return (
    <table style={s.table}>
      <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{caption}</caption>
      <colgroup>{columns.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
      <thead>
        <tr>
          {columns.map(c => {
            const active = sort && sort.key === c.key;
            const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
            return (
              <th key={c.key} scope="col" aria-sort={c.sortable === false ? undefined : ariaSort} style={{ ...s.th, textAlign: c.numeric ? 'right' : 'left' }}>
                {c.sortable === false
                  ? <span style={{ ...s.thBtn, cursor: 'default', justifyContent: c.align === 'center' ? 'center' : undefined }}>{c.header ?? c.label}</span>
                  : (
                    <button style={{ ...s.thBtn, justifyContent: c.numeric ? 'flex-end' : 'flex-start', color: active ? 'var(--text-primary)' : 'inherit' }}
                      onClick={() => onSort(nextSort(sort, c.key, !!c.numeric))}>
                      {c.label}
                      <span aria-hidden style={{ fontSize: scale(10), opacity: active ? 1 : 0.35 }}>
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {shown.map(r => (
          <tr key={rowKey(r)}>
            {columns.map(c => (
              <td key={c.key} title={c.title ? c.title(r) : undefined}
                style={{ ...s.td, ...(c.rtl ? s.rtl : null), textAlign: c.numeric ? 'right' : c.align || (c.rtl ? 'left' : undefined), color: c.muted ? 'var(--text-secondary)' : undefined }}>
                {c.render ? c.render(r) : r[c.key]}
              </td>
            ))}
          </tr>
        ))}
        {rows.length > shown.length && (
          <tr>
            <td colSpan={columns.length} style={{ ...s.td, textAlign: 'center', borderBottom: 'none' }}>
              <button style={s.btn} onClick={() => setLimit(l => l + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown.length).toLocaleString()} more of {(rows.length - shown.length).toLocaleString()}
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}


// Default styles for SortableTable, for screens that don't define their own.
export function makeTableStyles(scale) {
  return {
    table:   { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: scale(13), tableLayout: 'fixed' },
    th:      { position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-card)', borderBottom: '1px solid var(--border-strong, var(--border))', textAlign: 'left', fontWeight: 500, fontSize: scale(12), color: 'var(--text-secondary)', padding: 0, whiteSpace: 'nowrap' },
    thBtn:   { width: '100%', display: 'flex', alignItems: 'center', gap: scale(4), background: 'none', border: 'none', font: 'inherit', color: 'inherit', padding: `${scale(8)}px ${scale(10)}px`, cursor: 'pointer', textAlign: 'left' },
    td:      { padding: `${scale(7)}px ${scale(10)}px`, borderBottom: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    rtl:     { direction: 'rtl', textAlign: 'left' },
    btn:     { padding: `${scale(7)}px ${scale(14)}px`, borderRadius: scale(8), border: '1px solid var(--border-strong, var(--border))', background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: scale(13), cursor: 'pointer', whiteSpace: 'nowrap' },
  };
}
