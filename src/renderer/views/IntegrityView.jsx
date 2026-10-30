import React, { useState, useEffect, useMemo } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import SortableTable, { makeTableStyles } from '../components/SortableTable.jsx';
import { sortRows } from '../utils/sortRows.js';

const api = window.electronAPI;

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
const formatDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// What each finding means, worst first.
const KINDS = [
  { id: 'corrupted',  label: 'Damaged',          color: 'var(--danger)',  desc: 'Same size and date as recorded, but different bytes. This is silent damage (disk errors, bit rot) or tampering. Restore these from your backup.' },
  { id: 'missing',    label: 'Missing',          color: 'var(--danger)',  desc: 'In the record, but no longer in the archive.' },
  { id: 'modified',   label: 'Changed',          color: 'var(--warning)', desc: 'The date or size changed since the record was written, so the file was edited or replaced. Check that was intended.' },
  { id: 'unreadable', label: "Couldn't be read", color: 'var(--warning)', desc: 'These files couldn’t be opened, so they weren’t checked.' },
  { id: 'added',      label: 'New since record', color: 'var(--text-secondary)', desc: 'Not in the record. Archive again to include them.' },
];

// Re-check an archive against its integrity record.
export default function IntegrityView({ root, onBack }) {
  const { scale } = useDPR();
  const s = useMemo(() => ({
    ...makeTableStyles(scale),
    page:  { height: '100%', overflowY: 'auto', padding: `${scale(24)}px ${scale(32)}px`, display: 'flex', flexDirection: 'column' },
    card:  { flexShrink: 0, marginBottom: scale(14), padding: `${scale(12)}px ${scale(16)}px`, borderRadius: scale(10), border: '1px solid var(--border)', background: 'var(--bg-card)' },
    big:   { fontSize: scale(15), fontWeight: 600 },
    sub:   { fontSize: scale(12), color: 'var(--text-secondary)', marginTop: scale(3), lineHeight: 1.5 },
    panel: { flex: '1 1 auto', minHeight: scale(260), display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: scale(12), overflow: 'hidden' },
  }), [scale]);

  const [state, setState] = useState({ running: true, progress: null });
  const [tab, setTab] = useState(null);
  const [sort, setSort] = useState({ key: 'p', dir: 'asc' });

  useEffect(() => {
    if (!api?.archiveVerify) { setState({ running: false, error: 'Not available outside the app' }); return undefined; }
    let alive = true;
    api.onArchiveProgress?.(p => alive && setState(st => ({ ...st, progress: p })));
    api.archiveVerify(root)
      .then(report => alive && setState({ running: false, report }))
      .catch(e => alive && setState({ running: false, error: e.message }))
      .finally(() => api.removeArchiveProgress?.());
    return () => { alive = false; };
  }, [root]);

  const { running, progress, report, error } = state;
  const firstProblem = report && KINDS.find(k => report.counts[k.id] > 0);
  const current = KINDS.find(k => k.id === (tab || firstProblem?.id)) || null;
  const rows = report && current ? sortRows(report[current.id].map(e => ({ ...e, size: e.s })), sort.key, sort.dir) : [];
  const bad = report ? report.counts.corrupted + report.counts.missing : 0;
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={s.page}>
      <div style={{ ...s.card, borderColor: error || bad ? 'var(--danger)' : report ? 'var(--success)' : 'var(--border)' }} role="status">
        {running && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: scale(12) }}>
              <div style={s.big}>Re-reading every file in {root}… {progress?.total ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : ''}</div>
              <button style={s.btn} onClick={() => api?.archiveCancel?.()}>Stop</button>
            </div>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
              style={{ height: scale(6), borderRadius: scale(3), background: 'var(--bg-inset)', overflow: 'hidden', marginTop: scale(8) }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          </>
        )}
        {error && <div style={{ ...s.big, color: 'var(--danger)' }}>{error}</div>}
        {report?.cancelled && <div style={s.big}>Stopped — the check didn't finish.</div>}
        {report && !report.cancelled && (
          <>
            <div style={{ ...s.big, color: bad ? 'var(--danger)' : 'var(--success)' }}>
              {bad
                ? `⚠ ${report.counts.corrupted ? `${report.counts.corrupted.toLocaleString()} damaged` : ''}${report.counts.corrupted && report.counts.missing ? ' and ' : ''}${report.counts.missing ? `${report.counts.missing.toLocaleString()} missing` : ''} file${bad !== 1 ? 's' : ''}`
                : `✓ All ${report.ok.toLocaleString()} recorded files are intact`}
            </div>
            <div style={s.sub}>
              {report.ok.toLocaleString()} of {report.recordedFiles.toLocaleString()} files match the record from {formatDate(report.recordedAt)}, byte for byte.
              {report.counts.modified > 0 && ` ${report.counts.modified.toLocaleString()} changed on purpose.`}
              {report.counts.added > 0 && ` ${report.counts.added.toLocaleString()} new since the record.`}
            </div>
          </>
        )}
      </div>

      {report && !report.cancelled && (
        <section style={s.panel} aria-label="Findings">
          <div style={{ display: 'flex', gap: scale(4), padding: `${scale(10)}px ${scale(12)}px`, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }} role="group" aria-label="Choose which files to list">
            {KINDS.filter(k => report.counts[k.id] > 0).map(k => (
              <button key={k.id} aria-pressed={current?.id === k.id} onClick={() => setTab(k.id)} style={{
                padding: `${scale(5)}px ${scale(12)}px`, borderRadius: scale(8), font: 'inherit', fontSize: scale(13), cursor: 'pointer',
                border: current?.id === k.id ? `1px solid ${k.color}` : '1px solid transparent',
                background: current?.id === k.id ? 'var(--bg-inset)' : 'transparent', color: k.color,
              }}>{k.label} ({report.counts[k.id].toLocaleString()})</button>
            ))}
            {!firstProblem && <span style={{ fontSize: scale(13), color: 'var(--text-secondary)', padding: `${scale(5)}px 0` }}>Nothing to report.</span>}
          </div>
          {current && <p style={{ ...s.sub, margin: 0, padding: `${scale(10)}px ${scale(16)}px`, borderBottom: '1px solid var(--border)' }}>{current.desc}</p>}
          <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
            {current && (
              <SortableTable s={s} scale={scale} rows={rows} sort={sort} onSort={setSort} rowKey={r => r.p}
                caption={current.label} resetKey={`${current.id}:${sort.key}:${sort.dir}`}
                columns={[
                  { key: 'p', label: 'File (in the archive)', width: '60%', rtl: true, title: r => r.p },
                  { key: 'size', label: 'Size', numeric: true, width: '15%', render: r => formatSize(r.s ?? r.was?.s) },
                  { key: 'm', label: 'Modified', numeric: true, width: '25%', render: r => formatDate(r.m || r.was?.m) },
                ]} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${scale(10)}px ${scale(16)}px`, borderTop: '1px solid var(--border)', fontSize: scale(12), color: 'var(--text-secondary)', flexShrink: 0 }}>
            <span>{root}</span>
            <button style={s.btn} onClick={onBack}>Done</button>
          </div>
        </section>
      )}
      {(error || report?.cancelled) && <div><button style={s.btn} onClick={onBack}>Back</button></div>}
    </div>
  );
}
