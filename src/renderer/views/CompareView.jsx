import React, { useState, useMemo, useEffect } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { ShieldIcon, CheckCircleIcon, HalfCircleIcon, ChevronRightIcon } from '../components/icons.jsx';
import { sortRows, nextSort } from '../utils/sortRows.js';

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

const CONFIDENCE_LABELS = { quick: 'Quick match', standard: 'Standard match', thorough: 'Thorough match' };
const PAGE = 500;            // rows rendered per "show more"
const WORKER_LIST_CAP = 5000; // the scan keeps at most this many paths per census list

function lastSegment(p) {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
function parentOf(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : '';
}
const fileRow = (f, extra) => ({ path: f.path, name: lastSegment(f.path), folder: parentOf(f.path), size: f.size, modified: f.modified, ...extra });

// Folder rows are keyed by root + relative path. With several target roots,
// prefix the root's name so same-named folders can be told apart.
function folderLabel(f, multiRoot) {
  const rel = f.path === '.' ? '(top level)' : f.path;
  return multiRoot ? `${lastSegment(f.root)} › ${rel}` : (f.path === '.' ? `${lastSegment(f.root)} (top level)` : rel);
}
const STATE_RANK = { partial: 0, all: 1, none: 2 };

function makeStyles(scale) {
  return {
    // The page is a column: summary on top, then the list panel filling the
    // rest of the window with its own scrolling (header and footer stay put).
    page:    { height: '100%', overflowY: 'auto', padding: `${scale(24)}px ${scale(32)}px`, display: 'flex', flexDirection: 'column' },
    rootRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: scale(24), marginBottom: scale(16), flexShrink: 0 },
    eyebrow: { fontSize: scale(12), color: 'var(--text-secondary)', marginBottom: scale(4), display: 'flex', alignItems: 'center', gap: scale(6) },
    rootPath:{ fontSize: scale(13), color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' },
    bigNum:  { fontSize: scale(26), fontWeight: 500, marginTop: scale(2) },
    bar:     { display: 'flex', height: scale(40), borderRadius: scale(8), overflow: 'hidden', gap: 2, marginBottom: scale(6), flexShrink: 0 },
    barLbl:  { display: 'flex', justifyContent: 'space-between', fontSize: scale(12), color: 'var(--text-secondary)', marginBottom: scale(16), flexShrink: 0 },
    tiles:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(' + scale(190) + 'px, 1fr))', gap: scale(12), marginBottom: scale(16), flexShrink: 0 },
    tile:    { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: scale(12), padding: `${scale(14)}px ${scale(16)}px`, textAlign: 'left', cursor: 'pointer', font: 'inherit', transition: 'box-shadow 0.12s ease, background 0.12s ease' },
    tileNum: { fontSize: scale(22), fontWeight: 500 },
    tileLbl: { fontSize: scale(13), marginTop: scale(2), color: 'var(--text-primary)' },
    tileSub: { fontSize: scale(12), color: 'var(--text-secondary)', marginTop: scale(2) },
    note:    { fontSize: scale(12), color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: scale(12), flexShrink: 0 },
    panel:   { flex: '1 1 auto', minHeight: scale(320), display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: scale(12), overflow: 'hidden' },
    panelHead: { display: 'flex', alignItems: 'flex-start', gap: scale(16), padding: `${scale(14)}px ${scale(16)}px`, borderBottom: '1px solid var(--border)', flexShrink: 0 },
    panelTitle: { fontSize: scale(14), fontWeight: 600, margin: 0 },
    panelDesc: { fontSize: scale(12), color: 'var(--text-secondary)', margin: `${scale(3)}px 0 0`, lineHeight: 1.5, maxWidth: scale(640) },
    scroll:  { flex: '1 1 auto', overflow: 'auto', minHeight: 0 },
    table:   { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: scale(13), tableLayout: 'fixed' },
    th:      { position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-card)', borderBottom: '1px solid var(--border-strong, var(--border))', textAlign: 'left', fontWeight: 500, fontSize: scale(12), color: 'var(--text-secondary)', padding: 0, whiteSpace: 'nowrap' },
    thBtn:   { width: '100%', display: 'flex', alignItems: 'center', gap: scale(4), background: 'none', border: 'none', font: 'inherit', color: 'inherit', padding: `${scale(8)}px ${scale(10)}px`, cursor: 'pointer', textAlign: 'left' },
    td:      { padding: `${scale(7)}px ${scale(10)}px`, borderBottom: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    rtl:     { direction: 'rtl', textAlign: 'left' },
    foot:    { display: 'flex', alignItems: 'center', gap: scale(12), flexWrap: 'wrap', padding: `${scale(10)}px ${scale(16)}px`, borderTop: '1px solid var(--border)', background: 'var(--bg-inset, var(--bg-card))', fontSize: scale(12), color: 'var(--text-secondary)', flexShrink: 0 },
    btn:     { padding: `${scale(7)}px ${scale(14)}px`, borderRadius: scale(8), border: '1px solid var(--border-strong, var(--border))', background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: scale(13), cursor: 'pointer', whiteSpace: 'nowrap' },
    btnPrimary: { padding: `${scale(7)}px ${scale(14)}px`, borderRadius: scale(8), border: 'none', background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: scale(13), fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: scale(4) },
    seg:     { display: 'inline-flex', background: 'var(--bg-inset)', borderRadius: scale(8), padding: scale(2), flexShrink: 0 },
  };
}

// ── Small module-level components (stay mounted across re-renders) ───────────

// Tick: every file here is in the protected source. Half-circle: some aren't.
// Empty ring: none are.
function Mark({ state, scale }) {
  if (state === 'all') return <CheckCircleIcon size={scale(15)} color="var(--success)" />;
  if (state === 'partial') return <HalfCircleIcon size={scale(15)} color="var(--warning)" />;
  return <span aria-hidden style={{ display: 'inline-block', width: scale(13), height: scale(13), margin: scale(1), borderRadius: '50%', border: '1.5px solid var(--warning)' }} />;
}

function Check({ on, onToggle, label, scale }) {
  return (
    <button role="checkbox" aria-checked={!!on} aria-label={label} onClick={onToggle}
      style={{ width: scale(16), height: scale(16), flexShrink: 0, borderRadius: scale(4),
        border: on ? 'none' : '1px solid var(--border-strong, var(--border))',
        background: on ? 'var(--accent)' : 'transparent', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {on && <span style={{ color: '#fff', fontSize: scale(10), lineHeight: 1 }}>✓</span>}
    </button>
  );
}

// A box above the list. The selected one is outlined in its own colour.
function Tile({ num, color, label, sub, onClick, disabled, active, s }) {
  return (
    <button aria-pressed={!!active} disabled={disabled}
      style={{
        ...s.tile,
        opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer',
        boxShadow: active ? `inset 0 0 0 2px ${color}` : 'none',
        background: active ? `color-mix(in srgb, ${color} 7%, var(--bg-card))` : s.tile.background,
      }}
      onClick={disabled ? undefined : onClick}>
      <div style={{ ...s.tileNum, color }}>{num.toLocaleString()}</div>
      <div style={s.tileLbl}>{label}</div>
      <div style={s.tileSub}>{sub}</div>
    </button>
  );
}

// Sortable table with a sticky header, rendered PAGE rows at a time.
// `resetKey` changes when the list or its sort changes, and starts paging over.
function SortableTable({ columns, rows, sort, onSort, rowKey, caption, resetKey, s, scale }) {
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

// ── The screen ────────────────────────────────────────────────────────────────

export default function CompareView({ scanResult, scanConfig, onReviewFiles, onBack, ui = null, onUi }) {
  const { scale } = useDPR();
  const s = useMemo(() => makeStyles(scale), [scale]);

  const census = scanResult?.census;
  const confidence = scanResult?.confidence || 'standard';
  // Quick matches on name + size only: its "in both" is a guess and its
  // "only in target" includes renamed copies, so the latter is disabled.
  const isQuick = confidence === 'quick';

  // UI state lives in App (ui/onUi), so it survives a trip to the Results page.
  const [tab, setTab] = useState(() => ui?.tab || (isQuick ? 'matched' : 'targetOnly'));
  const [view, setView] = useState(() => ui?.view || 'files');            // 'files' | 'folders'
  const [sorts, setSorts] = useState(() => ui?.sorts || {});
  const [selFolders, setSelFolders] = useState(() => new Set(ui?.selFolders || []));
  useEffect(() => {
    onUi && onUi({ tab, view, sorts, selFolders: Array.from(selFolders) });
  }, [tab, view, sorts, selFolders]); // eslint-disable-line react-hooks/exhaustive-deps

  const folders = census?.folders || [];
  const multiRoot = (census?.roots?.target?.paths || []).length > 1;

  // Target files that have a copy in the protected source, with that copy.
  const matchedRows = useMemo(() => {
    const out = [];
    for (const g of scanResult?.groups || []) {
      if (!g.hasProtected) continue;
      const src = g.files.find(f => f.sourceLabel === 'protected');
      for (const f of g.files) if (f.sourceLabel === 'target') out.push(fileRow(f, { sourceCopy: src ? src.path : '' }));
    }
    return out;
  }, [scanResult]);
  const sourceOnlyRows = useMemo(() => (census?.sourceOnly.list || []).map(f => fileRow(f)), [census]);
  const targetOnlyRows = useMemo(() => (census?.targetOnly.list || []).map(f => fileRow(f)), [census]);
  const unreadableRows = useMemo(() => (census?.unreadable?.list || []).map(f => fileRow(f, { side: f.side === 'protected' ? 'Source' : 'Target' })), [census]);

  const folderRows = useMemo(() => folders.map(f => ({
    ...f, label: folderLabel(f, multiRoot), stateRank: STATE_RANK[f.state] ?? 3,
  })), [folders, multiRoot]);

  if (!census) {
    return <div style={{ padding: scale(40), color: 'var(--text-secondary)' }}>No comparison summary available for this scan.</div>;
  }

  const src = census.roots.source;
  const tgt = census.roots.target;
  const unread = census.unreadable || { sourceFiles: 0, targetFiles: 0, list: [] };
  const unreadTotal = unread.sourceFiles + unread.targetFiles;
  const total = Math.max(1, census.sourceOnly.files + census.matched.targetFiles + census.targetOnly.files);
  const pct = n => `${Math.max(2, (n / total) * 100)}%`;
  const srcName = lastSegment(src.paths[0]) || 'the source';
  const tgtName = lastSegment(tgt.paths[0]) || 'the target';

  // ── What each tab shows ──
  const TABS = {
    sourceOnly: {
      color: 'var(--accent)', count: census.sourceOnly.files, bytes: census.sourceOnly.bytes, rows: sourceOnlyRows,
      title: `Only in the protected source (${srcName})`,
      desc: `Source files with no copy anywhere in the target. The target is missing these. Nothing here can be deleted by this app.`,
      folders: false,
    },
    matched: {
      color: 'var(--success)', count: census.matched.targetFiles, bytes: census.matched.bytes, rows: matchedRows,
      title: isQuick ? `In both — matched by name and size` : `In both — target files that are copies of source files`,
      desc: isQuick
        ? `Each file below in ${tgtName} has a file with the same name and size in the protected source (right-hand column). Quick match doesn't read contents, so every deletion is checked byte-for-byte first.`
        : `Each file below in ${tgtName} has an identical copy in the protected source (right-hand column). These are the duplicates you can remove from the target. The source copies are never touched.`,
      folders: true,
    },
    targetOnly: {
      color: 'var(--warning)', count: census.targetOnly.files, bytes: census.targetOnly.bytes, rows: targetOnlyRows,
      title: `Only in the target (${tgtName})`,
      desc: `Target files with no copy in the protected source, so they aren't backed up there. Keep these, or copy them to the source before cleaning up the target.`,
      folders: true,
    },
    unreadable: {
      color: 'var(--danger)', count: unreadTotal, bytes: null, rows: unreadableRows,
      title: `Couldn't be read`,
      desc: `These files couldn't be opened during the scan (locked, permission denied, or removed), so they aren't counted as matched or unmatched.`,
      folders: false,
    },
  };
  const current = TABS[tab] || TABS.matched;
  const showFolders = view === 'folders' && current.folders;
  const sortKey = `${tab}:${showFolders ? 'folders' : 'files'}`;
  const defaultSort = showFolders ? { key: 'stateRank', dir: 'asc' } : (tab === 'matched' ? { key: 'size', dir: 'desc' } : { key: 'folder', dir: 'asc' });
  const sort = sorts[sortKey] || defaultSort;
  const setSort = (next) => setSorts(prev => ({ ...prev, [sortKey]: next }));
  const pick = (id) => setTab(id);

  // ── Columns ──
  const fileCols = [
    { key: 'name', label: 'File', width: '26%', title: r => r.path },
    { key: 'folder', label: 'Folder', width: tab === 'matched' ? '30%' : '44%', rtl: true, muted: true, title: r => r.folder },
    { key: 'size', label: 'Size', numeric: true, width: '11%', render: r => formatSize(r.size) },
    tab === 'matched'
      ? { key: 'sourceCopy', label: isQuick ? 'Same name in source' : 'Copy in source', width: '33%', rtl: true, muted: true, title: r => r.sourceCopy }
      : tab === 'unreadable'
        ? { key: 'side', label: 'Side', width: '19%' }
        : { key: 'modified', label: 'Modified', numeric: true, width: '19%', render: r => formatDate(r.modified) },
  ];

  let folderList = folderRows;
  if (tab === 'matched') folderList = folderRows.filter(f => f.matched > 0);
  if (tab === 'targetOnly') folderList = folderRows.filter(f => f.targetOnly > 0);
  const selectable = tab === 'matched';
  const allShownSelected = selectable && folderList.length > 0 && folderList.every(f => selFolders.has(f.key));
  const toggleFolder = (key) => setSelFolders(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const toggleAllShown = () => setSelFolders(prev => {
    const next = new Set(prev);
    folderList.forEach(f => (allShownSelected ? next.delete(f.key) : next.add(f.key)));
    return next;
  });
  const folderCols = [
    ...(selectable ? [{ key: 'select', sortable: false, width: scale(40), align: 'center',
      header: <Check scale={scale} on={allShownSelected} onToggle={toggleAllShown} label="Select all folders in this list" />,
      render: f => <Check scale={scale} on={selFolders.has(f.key)} onToggle={() => toggleFolder(f.key)} label={`Select ${f.label}`} /> }] : []),
    { key: 'stateRank', label: 'State', width: scale(70), render: f => <span title={{ all: 'Every file is in the source', partial: 'Some files are in the source', none: 'No file is in the source' }[f.state]}><Mark scale={scale} state={f.state} /></span> },
    { key: 'label', label: 'Folder', width: 'auto', rtl: true, title: f => (f.root ? `${f.root} › ${f.path}` : f.path) },
    { key: 'files', label: 'Files', numeric: true, width: '10%', render: f => f.files.toLocaleString() },
    { key: 'matched', label: isQuick ? 'Name match' : 'In source', numeric: true, width: '12%', render: f => f.matched.toLocaleString() },
    { key: 'targetOnly', label: 'Not in source', numeric: true, width: '13%', render: f => (
      <span style={{ color: f.targetOnly > 0 && !isQuick ? 'var(--warning)' : undefined }}>{f.targetOnly.toLocaleString()}{f.unreadable > 0 ? ` (+${f.unreadable} unreadable)` : ''}</span>) },
    { key: 'reclaimable', label: 'Frees', numeric: true, width: '11%', render: f => formatSize(f.reclaimable) },
  ];

  const rows = showFolders ? sortRows(folderList, sort.key, sort.dir) : sortRows(current.rows, sort.key, sort.dir);
  const listTruncated = !showFolders && tab !== 'matched' && current.rows.length < current.count && current.rows.length >= Math.min(WORKER_LIST_CAP, current.count);

  // Selection (folders view of "In both")
  const selectedFolderObjs = folderRows.filter(f => f.matched > 0 && selFolders.has(f.key));
  const selectedPaths = selectedFolderObjs.flatMap(f => f.matchedPaths || []);
  const selectedBytes = selectedFolderObjs.reduce((a, f) => a + (f.reclaimable || 0), 0);
  const anyTruncated = selectedFolderObjs.some(f => f.truncated);
  const review = () => (selectedPaths.length > 0
    ? onReviewFiles(selectedPaths, selectedFolderObjs.length === 1 ? selectedFolderObjs[0].label : `${selectedFolderObjs.length.toLocaleString()} folders`)
    : onReviewFiles(null));

  const segBtn = (active) => ({
    padding: `${scale(4)}px ${scale(12)}px`, borderRadius: scale(6), border: active ? '1px solid var(--border)' : '1px solid transparent',
    background: active ? 'var(--bg-card)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    font: 'inherit', fontSize: scale(12), cursor: 'pointer',
  });
  // Bar segments select the same lists as the boxes below them.
  const barSeg = (id, width, bg, content, label, disabled) => (
    <button key={id} aria-pressed={tab === id} aria-label={label} title={label} disabled={disabled}
      onClick={disabled ? undefined : () => pick(id)}
      style={{
        width, background: bg, border: 'none', padding: 0, font: 'inherit', fontSize: scale(13), color: 'var(--text-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer', opacity: tab === id ? 1 : 0.55,
        boxShadow: tab === id ? `inset 0 0 0 2px ${TABS[id].color}` : 'none', transition: 'opacity 0.12s ease',
      }}>
      {content}
    </button>
  );

  return (
    <div style={s.page}>
      {/* Roots */}
      <div style={s.rootRow}>
        <div style={{ maxWidth: '44%', minWidth: 0 }}>
          <div style={{ ...s.eyebrow, color: 'var(--accent)' }}><ShieldIcon size={scale(15)} /> Protected source</div>
          <div style={s.rootPath}>{src.paths[0] || ''}{src.paths.length > 1 ? ` +${src.paths.length - 1}` : ''}</div>
          <div style={s.bigNum}>{src.files.toLocaleString()}</div>
        </div>
        <div style={{ maxWidth: '44%', minWidth: 0, textAlign: 'right' }}>
          <div style={{ ...s.eyebrow, justifyContent: 'flex-end' }}>Scan target</div>
          <div style={{ ...s.rootPath, direction: 'rtl' }}>{tgt.paths[0] || ''}{tgt.paths.length > 1 ? ` +${tgt.paths.length - 1}` : ''}</div>
          <div style={s.bigNum}>{tgt.files.toLocaleString()}</div>
        </div>
      </div>

      {/* Bar — each segment opens its list */}
      <div style={s.bar} role="group" aria-label="Choose which files to list">
        {barSeg('sourceOnly', pct(census.sourceOnly.files), 'color-mix(in srgb, var(--accent) 26%, transparent)', null, `${census.sourceOnly.files.toLocaleString()} only in source`)}
        {barSeg('matched', pct(census.matched.targetFiles), 'color-mix(in srgb, var(--success) 30%, transparent)',
          `${census.matched.targetFiles.toLocaleString()} ${isQuick ? 'name matches' : 'in both'}`, `${census.matched.targetFiles.toLocaleString()} in both`)}
        {barSeg('targetOnly', pct(census.targetOnly.files), 'color-mix(in srgb, var(--warning) 34%, transparent)', null, `${census.targetOnly.files.toLocaleString()} only in target`, isQuick)}
      </div>
      <div style={s.barLbl}>
        <span>{census.sourceOnly.files.toLocaleString()} only in source</span>
        <span>{isQuick ? 'target-only count needs a standard scan' : `${census.targetOnly.files.toLocaleString()} only in target`}</span>
      </div>

      {/* Boxes — same choice as the bar, the selected one is outlined */}
      <div style={s.tiles} role="group" aria-label="Choose which files to list">
        <Tile s={s} active={tab === 'sourceOnly'} num={census.sourceOnly.files} color="var(--accent)"
          label="Only in source" sub={`${formatSize(census.sourceOnly.bytes)} · no copy in the target`}
          onClick={() => pick('sourceOnly')} />
        <Tile s={s} active={tab === 'matched'} num={census.matched.targetFiles} color="var(--success)"
          label={isQuick ? 'In both (name match)' : 'In both'}
          sub={`${formatSize(census.matched.bytes)} · target copies of source files`}
          onClick={() => pick('matched')} />
        <Tile s={s} active={tab === 'targetOnly'} num={census.targetOnly.files} color="var(--warning)"
          label="Only in target" sub={isQuick ? 'needs a standard scan' : `${formatSize(census.targetOnly.bytes)} · not in the source`}
          disabled={isQuick} onClick={() => pick('targetOnly')} />
      </div>

      {isQuick && (
        <div style={s.note}>
          Quick match compares file names and sizes only. A renamed copy looks like a file that isn't backed up,
          and a same-named file with different contents looks like a match. Every deletion is still checked
          byte-for-byte first, but run a standard scan before trusting these numbers.
        </div>
      )}
      {unreadTotal > 0 && (
        <div style={{ ...s.note, color: 'var(--warning)' }}>
          {unreadTotal.toLocaleString()} file{unreadTotal !== 1 ? 's' : ''} couldn't be read
          ({unread.sourceFiles.toLocaleString()} in source, {unread.targetFiles.toLocaleString()} in target) and {unreadTotal !== 1 ? 'are' : 'is'} not
          counted as matched or unmatched.{' '}
          <button onClick={() => pick('unreadable')} aria-pressed={tab === 'unreadable'}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', font: 'inherit', cursor: 'pointer', textDecoration: tab === 'unreadable' ? 'underline' : 'none' }}>
            List them
          </button>
        </div>
      )}

      {/* The list — its own scrolling panel, header and footer always visible */}
      <section style={{ ...s.panel, boxShadow: `inset 3px 0 0 ${current.color}` }} aria-labelledby="compare-list-title">
        <div style={s.panelHead}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="compare-list-title" style={s.panelTitle}>{current.title}</h2>
            <p style={s.panelDesc}>{current.desc}</p>
          </div>
          {current.folders && (
            <div style={s.seg} role="group" aria-label="List by">
              <button aria-pressed={!showFolders} style={segBtn(!showFolders)} onClick={() => setView('files')}>Files</button>
              <button aria-pressed={showFolders} style={segBtn(showFolders)} onClick={() => setView('folders')}>By folder</button>
            </div>
          )}
          {tab === 'matched' && (
            <button style={s.btnPrimary} onClick={review}>
              {selectedPaths.length > 0 ? `Review ${selectedPaths.length.toLocaleString()} selected` : 'Review and delete'} <ChevronRightIcon size={scale(13)} />
            </button>
          )}
        </div>

        <div style={s.scroll}>
          {rows.length === 0 ? (
            <div style={{ padding: scale(24), color: 'var(--text-secondary)', fontSize: scale(13) }}>
              {tab === 'targetOnly' ? 'Nothing here — every target file exists in the protected source.'
                : tab === 'sourceOnly' ? 'Nothing here — every source file has a copy in the target.'
                : 'Nothing here.'}
            </div>
          ) : showFolders ? (
            <SortableTable s={s} scale={scale} columns={folderCols} rows={rows} sort={sort} onSort={setSort}
              rowKey={f => f.key} caption={`${current.title}, by folder`} resetKey={`${sortKey}:${sort.key}:${sort.dir}`} />
          ) : (
            <SortableTable s={s} scale={scale} columns={fileCols} rows={rows} sort={sort} onSort={setSort}
              rowKey={r => r.path} caption={current.title} resetKey={`${sortKey}:${sort.key}:${sort.dir}`} />
          )}
        </div>

        <div style={s.foot}>
          {showFolders ? (
            <span style={{ flex: 1 }}>
              {folderList.length.toLocaleString()} of {folders.length.toLocaleString()} target folders
              · {folderList.reduce((a, f) => a + f.files, 0).toLocaleString()} files
              · <span style={{ color: 'var(--success)' }}>{folderList.reduce((a, f) => a + f.matched, 0).toLocaleString()} {isQuick ? 'name-matched' : 'in source'}</span>
              {!isQuick && <> · <span style={{ color: 'var(--warning)' }}>{folderList.reduce((a, f) => a + f.targetOnly, 0).toLocaleString()} not in source</span></>}
            </span>
          ) : (
            <span style={{ flex: 1 }}>
              {current.count.toLocaleString()} file{current.count !== 1 ? 's' : ''}
              {current.bytes != null && ` · ${formatSize(current.bytes)}`}
              {listTruncated && ` · listing the first ${current.rows.length.toLocaleString()}`}
              {' · '}{CONFIDENCE_LABELS[confidence]} · {(scanResult.totalScanned || 0).toLocaleString()} files scanned
            </span>
          )}
          {showFolders && selectable && selectedFolderObjs.length > 0 && (
            <>
              <span>
                {selectedFolderObjs.length.toLocaleString()} selected · {selectedPaths.length.toLocaleString()} files · {formatSize(selectedBytes)}
                {anyTruncated && ' · list truncated, review before deleting'}
              </span>
              <button style={s.btn} onClick={() => setSelFolders(new Set())}>Clear</button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
