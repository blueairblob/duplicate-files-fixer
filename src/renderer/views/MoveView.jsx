import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { useDialog } from '../hooks/useDialog.js';
import SortableTable, { makeTableStyles } from '../components/SortableTable.jsx';
import { sortRows } from '../utils/sortRows.js';
import { previewDestination } from '../utils/movePreview.js';
import { ShieldIcon, FolderIcon, ChevronRightIcon } from '../components/icons.jsx';

const api = window.electronAPI;

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const leaf = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const parent = (p) => { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i > 0 ? p.slice(0, i) : ''; };
const sum = (rows) => rows.reduce((a, r) => a + (r.size || 0), 0);

function ConfirmFreeUp({ count, bytes, fromLabel, onConfirm, onClose, scale, s }) {
  const ref = useDialog(onClose);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="free-up-title" tabIndex={-1} onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sheet)', padding: scale(24), width: scale(440), maxWidth: '90vw' }}>
        <h2 id="free-up-title" style={{ fontSize: 'var(--fs-heading)', fontWeight: 600, marginBottom: scale(6) }}>
          Remove {count.toLocaleString()} local file{count !== 1 ? 's' : ''}?
        </h2>
        <p style={{ fontSize: 'var(--fs-secondary)', color: 'var(--text-secondary)', marginBottom: scale(16), lineHeight: 1.5 }}>
          These files in {fromLabel} have an identical copy in the backup. Each one is compared byte for byte with its
          backup copy again just before it's removed, and anything that doesn't match is left alone. Removed files go to the
          Recycle Bin, freeing {formatSize(bytes)}. The backup is never changed.
        </p>
        <div style={{ display: 'flex', gap: scale(10), justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={s.btn}>Cancel</button>
          <button onClick={onConfirm} style={{ ...s.btnPrimary, background: 'var(--danger)' }}>Remove local copies</button>
        </div>
      </div>
    </div>
  );
}

// One screen for the three transfer stages. They share the engine (copy
// only what the destination doesn't already have, verify every copy) and
// differ in wording and in what may happen afterwards.
const JOBS = {
  import: {
    to: 'Inbox', have: 'Already imported or backed up', copyVerb: 'Import', layouts: true, freeUp: false, record: false,
    nothingNew: '✓ Everything on this device is already imported',
    note: 'Nothing on the device is changed. When you’re happy, delete the photos or format the card in the camera.',
  },
  move: {
    to: 'backup', have: 'Already in the backup', copyVerb: 'Copy', layouts: true, freeUp: true, record: false,
    nothingNew: '✓ Everything here is already in the backup',
  },
  archive: {
    to: 'archive', have: 'Already in the archive', copyVerb: 'Archive', layouts: false, freeUp: false, record: true,
    nothingNew: '✓ Everything in the backup is already in the archive',
    note: 'The archive mirrors the backup’s folders. The backup is never changed.',
  },
};

export default function MoveView({ scanResult, scanConfig, onDone, onBack }) {
  const J = JOBS[scanConfig?.job] || JOBS.move;
  const { scale } = useDPR();
  const s = useMemo(() => ({
    ...makeTableStyles(scale),
    page:   { height: '100%', overflowY: 'auto', padding: `${scale(24)}px ${scale(32)}px`, display: 'flex', flexDirection: 'column' },
    head:   { display: 'flex', alignItems: 'center', gap: scale(12), marginBottom: scale(14), flexShrink: 0, fontSize: scale(13), color: 'var(--text-secondary)', minWidth: 0 },
    pathBox:{ display: 'inline-flex', alignItems: 'center', gap: scale(6), minWidth: 0, maxWidth: '45%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
    card:   { flexShrink: 0, marginBottom: scale(14), padding: `${scale(12)}px ${scale(16)}px`, borderRadius: scale(10), border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: scale(14), flexWrap: 'wrap' },
    big:    { fontSize: scale(15), fontWeight: 600 },
    sub:    { fontSize: scale(12), color: 'var(--text-secondary)', marginTop: scale(2), lineHeight: 1.5 },
    panel:  { flex: '1 1 auto', minHeight: scale(300), display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: scale(12), overflow: 'hidden' },
    tabs:   { display: 'flex', gap: scale(4), padding: `${scale(10)}px ${scale(12)}px`, borderBottom: '1px solid var(--border)', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' },
    scroll: { flex: '1 1 auto', overflow: 'auto', minHeight: 0 },
    foot:   { display: 'flex', alignItems: 'center', gap: scale(12), flexWrap: 'wrap', padding: `${scale(10)}px ${scale(16)}px`, borderTop: '1px solid var(--border)', background: 'var(--bg-inset, var(--bg-card))', fontSize: scale(12), color: 'var(--text-secondary)', flexShrink: 0 },
    btnPrimary: { padding: `${scale(8)}px ${scale(16)}px`, borderRadius: scale(8), border: 'none', background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: scale(13), fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: scale(4) },
    seg:    { display: 'inline-flex', background: 'var(--bg-inset)', borderRadius: scale(8), padding: scale(2) },
  }), [scale]);

  const plan = scanResult?.move;
  const toRoot = (scanConfig?.protectedFolders || [])[0] || '';
  const fromRoots = scanConfig?.targetFolders || [];
  const fromLabel = fromRoots.length === 1 ? leaf(fromRoots[0]) : `${fromRoots.length} folders`;

  const [tab, setTab] = useState('new');
  const [layout, setLayout] = useState(scanConfig?.job === 'archive' ? 'folders' : 'date');
  const [record, setRecord] = useState(null);           // archive: { running, progress, result, error }
  const [sorts, setSorts] = useState({});
  const [stage, setStage] = useState('plan');          // plan → copying → copied
  const [progress, setProgress] = useState(null);
  const [copyResult, setCopyResult] = useState(null);
  const [freeSummary, setFreeSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [freeing, setFreeing] = useState(false);

  const refreshSummary = useCallback(async () => {
    if (!api?.moveFreeUpSummary) return;
    try { setFreeSummary(await api.moveFreeUpSummary()); } catch { setFreeSummary(null); }
  }, []);
  useEffect(() => { refreshSummary(); }, [refreshSummary]);

  const copiedSet = useMemo(() => new Set((copyResult?.copied || []).map(c => c.local)), [copyResult]);
  const newRows = useMemo(() => (plan?.newFiles || []).map(f => ({
    path: f.path, name: leaf(f.path), folder: parent(f.path), size: f.size, modified: f.modified,
    dest: previewDestination(f, toRoot, layout), done: copiedSet.has(f.path),
  })), [plan, toRoot, layout, copiedSet]);
  const inBackupRows = useMemo(() => (plan?.inBackup || []).map(x => ({
    path: x.file.path, name: leaf(x.file.path), folder: parent(x.file.path), size: x.file.size, backup: x.backup,
  })), [plan]);
  const unreadRows = useMemo(() => (plan?.unreadable || []).map(f => ({ path: f.path, name: leaf(f.path), folder: parent(f.path), size: f.size })), [plan]);

  if (!plan) {
    return <div style={{ padding: scale(40), color: 'var(--text-secondary)' }}>No move plan for this scan. Run Move to backup again.</div>;
  }

  const remaining = newRows.filter(r => !r.done);
  const TABS = {
    new:        { label: 'New — to copy', rows: newRows, empty: `Nothing new — ${J.nothingNew.replace('✓ ', '').toLowerCase()}.` },
    inBackup:   { label: J.have, rows: inBackupRows, empty: `Nothing here is in the ${J.to} yet.` },
    unreadable: { label: "Couldn't be read", rows: unreadRows, empty: 'Nothing here.' },
  };
  const current = TABS[tab];
  const defaultSort = tab === 'new' ? { key: 'dest', dir: 'asc' } : { key: 'folder', dir: 'asc' };
  const sort = sorts[tab] || defaultSort;
  const rows = sortRows(current.rows, sort.key, sort.dir);

  const cols = tab === 'new'
    ? [
        { key: 'name', label: 'File', width: '22%', title: r => r.path },
        { key: 'size', label: 'Size', numeric: true, width: '10%', render: r => formatSize(r.size) },
        { key: 'modified', label: 'Date', numeric: true, width: '13%', render: r => formatDate(r.modified) },
        { key: 'dest', label: stage === 'plan' ? 'Will be copied to' : 'Copied to', width: '55%', rtl: true, muted: true, title: r => r.dest,
          render: r => <span style={{ color: r.done ? 'var(--success)' : undefined }}>{r.done ? '✓ ' : ''}{r.dest}</span> },
      ]
    : tab === 'inBackup'
      ? [
          { key: 'name', label: 'File', width: '22%', title: r => r.path },
          { key: 'folder', label: 'Folder here', width: '28%', rtl: true, muted: true, title: r => r.folder },
          { key: 'size', label: 'Size', numeric: true, width: '10%', render: r => formatSize(r.size) },
          { key: 'backup', label: `Same file in ${J.to}`, width: '40%', rtl: true, muted: true, title: r => r.backup },
        ]
      : [
          { key: 'name', label: 'File', width: '30%', title: r => r.path },
          { key: 'folder', label: 'Folder', width: '55%', rtl: true, muted: true },
          { key: 'size', label: 'Size', numeric: true, width: '15%', render: r => formatSize(r.size) },
        ];

  const copy = async () => {
    if (!api?.moveCopy) return;
    setStage('copying');
    setProgress(null);
    api.onMoveProgress?.(p => setProgress(p));
    try {
      const r = await api.moveCopy({ layout });
      setCopyResult(prev => prev ? { ...r, copied: [...prev.copied, ...r.copied] } : r);
    } catch (e) {
      setCopyResult({ copied: [], skipped: [], failed: [{ path: '-', error: e.message }], bytes: 0 });
    } finally {
      api.removeMoveProgress?.();
    }
    setStage('copied');
    refreshSummary();
    if (J.record) writeRecord();
  };

  // Archive: fingerprint every file in the archive into its integrity record.
  const writeRecord = async () => {
    if (!api?.archiveRecord) return;
    setRecord({ running: true, progress: null });
    api.onArchiveProgress?.(p => setRecord(r => ({ ...r, progress: p })));
    try {
      const result = await api.archiveRecord();
      setRecord({ running: false, result });
    } catch (e) {
      setRecord({ running: false, error: e.message });
    } finally {
      api.removeArchiveProgress?.();
    }
  };

  const freeUp = async () => {
    setConfirmOpen(false);
    setFreeing(true);
    setProgress(null);
    api.onMoveProgress?.(p => setProgress(p));
    let result;
    try { result = await api.moveFreeUp(); }
    catch (e) { result = { trashed: [], quarantined: [], skipped: [], failed: [{ path: '-', error: e.message }], freedBytes: 0 }; }
    finally { api.removeMoveProgress?.(); }
    setFreeing(false);
    onDone({ ...result, totalScanned: scanResult.totalScanned || 0 });
  };

  const tabBtn = (id) => (
    <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)} style={{
      padding: `${scale(5)}px ${scale(12)}px`, borderRadius: scale(8), font: 'inherit', fontSize: scale(13), cursor: 'pointer',
      border: tab === id ? '1px solid var(--border-strong, var(--border))' : '1px solid transparent',
      background: tab === id ? 'var(--bg-inset)' : 'transparent', color: tab === id ? 'var(--text-primary)' : 'var(--text-secondary)',
    }}>
      {TABS[id].label} <span style={{ color: 'var(--text-secondary)' }}>({TABS[id].rows.length.toLocaleString()})</span>
    </button>
  );
  const busy = stage === 'copying' || freeing;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={s.page}>
      {/* From → To */}
      <div style={s.head}>
        <span style={s.pathBox} title={fromRoots.join('\n')}><FolderIcon size={scale(15)} /> {fromRoots.length === 1 ? fromRoots[0] : `${fromRoots.length} folders`}</span>
        <ChevronRightIcon size={scale(14)} />
        <span style={{ ...s.pathBox, color: 'var(--accent)' }} title={toRoot}><ShieldIcon size={scale(15)} /> {toRoot}</span>
      </div>

      {/* What the scan found */}
      <div role="status" style={{ ...s.card, borderColor: newRows.length ? 'var(--accent)' : 'var(--success)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...s.big, color: newRows.length ? 'var(--text-primary)' : 'var(--success)' }}>
            {newRows.length
              ? `${newRows.length.toLocaleString()} new file${newRows.length !== 1 ? 's' : ''} to copy to the ${J.to} · ${formatSize(sum(newRows))}`
              : J.nothingNew}
          </div>
          <div style={s.sub}>
            {inBackupRows.length.toLocaleString()} file{inBackupRows.length !== 1 ? 's are' : ' is'} already in the {J.to} ({formatSize(sum(inBackupRows))}), matched byte for byte wherever they are in it.{J.note ? ` ${J.note}` : ''}
            {unreadRows.length > 0 && ` ${unreadRows.length.toLocaleString()} couldn't be read and will be left alone.`}
          </div>
        </div>
        {stage === 'plan' && newRows.length > 0 && (
          <>
            {J.layouts && <div style={s.seg} role="group" aria-label="Where new files go">
              {[['date', 'Year / Month'], ['folders', 'Same folders']].map(([id, label]) => (
                <button key={id} aria-pressed={layout === id} onClick={() => setLayout(id)} style={{
                  padding: `${scale(4)}px ${scale(12)}px`, borderRadius: scale(6), font: 'inherit', fontSize: scale(12), cursor: 'pointer',
                  border: layout === id ? '1px solid var(--border)' : '1px solid transparent',
                  background: layout === id ? 'var(--bg-card)' : 'transparent', color: layout === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>{label}</button>
              ))}
            </div>}
            <button style={s.btnPrimary} onClick={copy} disabled={!api}>
              {J.copyVerb} {newRows.length.toLocaleString()} file{newRows.length !== 1 ? 's' : ''} <ChevronRightIcon size={scale(13)} />
            </button>
          </>
        )}
      </div>

      {/* Progress */}
      {busy && (
        <div style={{ ...s.card, display: 'block' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: scale(13), marginBottom: scale(6) }}>
            <span>{freeing ? 'Removing local copies…' : 'Copying and verifying…'}{progress?.total ? ` ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : ''}</span>
            <button style={s.btn} onClick={() => api?.moveCancel?.()}>Stop</button>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
            style={{ height: scale(6), borderRadius: scale(3), background: 'var(--bg-inset)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s ease' }} />
          </div>
        </div>
      )}

      {/* After copying */}
      {stage === 'copied' && copyResult && (
        <div style={{ ...s.card, borderColor: copyResult.failed.length ? 'var(--warning)' : 'var(--success)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...s.big, color: copyResult.failed.length ? 'var(--warning)' : 'var(--success)' }}>
              {copyResult.cancelled ? 'Stopped. ' : ''}✓ {copyResult.copied.length.toLocaleString()} copied and verified · {formatSize(copyResult.bytes)}
            </div>
            <div style={s.sub}>
              {copyResult.skipped.length > 0 && `${copyResult.skipped.length.toLocaleString()} skipped (already there, or stopped). `}
              {copyResult.failed.length > 0 && `${copyResult.failed.length.toLocaleString()} failed and were left where they are: ${copyResult.failed.slice(0, 2).map(f => `${leaf(f.path)} — ${f.error}`).join('; ')}${copyResult.failed.length > 2 ? '…' : ''}`}
            </div>
          </div>
          {remaining.length > 0 && <button style={s.btn} onClick={copy}>Copy the remaining {remaining.length.toLocaleString()}</button>}
        </div>
      )}

      {/* Archive: integrity record */}
      {J.record && (record || (stage === 'plan' && newRows.length === 0)) && (
        <div style={{ ...s.card, borderColor: record?.error ? 'var(--danger)' : record?.result ? 'var(--success)' : 'var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...s.big, color: record?.error ? 'var(--danger)' : record?.result && !record.result.cancelled ? 'var(--success)' : 'var(--text-primary)' }}>
              {record?.running ? `Writing the integrity record… ${record.progress?.total ? `${record.progress.done.toLocaleString()} of ${record.progress.total.toLocaleString()} files` : ''}`
                : record?.error ? `Couldn't write the integrity record: ${record.error}`
                : record?.result?.cancelled ? 'Integrity record stopped — it was not written'
                : record?.result ? `✓ Integrity record written: ${record.result.files.toLocaleString()} files · ${formatSize(record.result.bytes)}`
                : 'Integrity record'}
            </div>
            <div style={s.sub}>
              {record?.result && !record.result.cancelled
                ? <>Saved as <code>{record.result.path}</code>. Use <strong>Re-check an archive</strong> on the Archive page to test it for damage later.</>
                : 'Every file in the archive is read and fingerprinted, so it can be re-checked for silent damage or changes later.'}
            </div>
          </div>
          {record?.running
            ? <button style={s.btn} onClick={() => api?.archiveCancel?.()}>Stop</button>
            : !record?.result || record.result.cancelled ? <button style={s.btn} onClick={writeRecord} disabled={!api}>Write integrity record</button> : null}
        </div>
      )}

      {/* Free up space */}
      {J.freeUp && !busy && freeSummary && freeSummary.files > 0 && (
        <div style={s.card}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.big}>Free up {formatSize(freeSummary.bytes)} on this computer</div>
            <div style={s.sub}>
              {freeSummary.files.toLocaleString()} local file{freeSummary.files !== 1 ? 's are' : ' is'} now safely in the backup. Remove them from {fromLabel}?
              They're checked again first and go to the Recycle Bin.
            </div>
          </div>
          <button style={s.btn} onClick={() => setConfirmOpen(true)} disabled={!api}>Free up space…</button>
        </div>
      )}

      {/* Lists */}
      <section style={s.panel} aria-label="Files">
        <div style={s.tabs} role="group" aria-label="Choose which files to list">
          {['new', 'inBackup', ...(unreadRows.length ? ['unreadable'] : [])].map(tabBtn)}
        </div>
        <div style={s.scroll}>
          {rows.length === 0
            ? <div style={{ padding: scale(24), color: 'var(--text-secondary)', fontSize: scale(13) }}>{current.empty}</div>
            : <SortableTable s={s} scale={scale} columns={cols} rows={rows} sort={sort}
                onSort={(next) => setSorts(prev => ({ ...prev, [tab]: next }))} rowKey={r => r.path}
                caption={current.label} resetKey={`${tab}:${sort.key}:${sort.dir}:${layout}`} />}
        </div>
        <div style={s.foot}>
          <span style={{ flex: 1 }}>{current.rows.length.toLocaleString()} file{current.rows.length !== 1 ? 's' : ''} · {formatSize(sum(current.rows))}</span>
          <span>Thorough match · {(scanResult.totalScanned || 0).toLocaleString()} files scanned</span>
          <button style={s.btn} onClick={onBack}>New scan</button>
        </div>
      </section>

      {confirmOpen && freeSummary && (
        <ConfirmFreeUp count={freeSummary.files} bytes={freeSummary.bytes} fromLabel={fromLabel}
          onConfirm={freeUp} onClose={() => setConfirmOpen(false)} scale={scale} s={s} />
      )}
    </div>
  );
}
