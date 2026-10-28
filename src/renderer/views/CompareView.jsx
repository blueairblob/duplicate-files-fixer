import React, { useState, useMemo } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { ShieldIcon, ChevronRightIcon, ChevronDownIcon, CheckCircleIcon, HalfCircleIcon } from '../components/icons.jsx';

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const CONFIDENCE_LABELS = { quick: 'Quick match', standard: 'Standard match', thorough: 'Thorough match' };
const ROW_CAP = 300;

function lastSegment(p) {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

// Folder rows are keyed by root + relative path. With several target roots,
// prefix the root's name so same-named folders can be told apart.
function folderLabel(f, multiRoot) {
  const rel = f.path === '.' ? '(top level)' : f.path;
  return multiRoot ? `${lastSegment(f.root)} › ${rel}` : (f.path === '.' ? `${lastSegment(f.root)} (top level)` : rel);
}

function makeStyles(scale) {
  return {
    page:    { padding: `${scale(28)}px ${scale(32)}px`, overflowY: 'auto', height: '100%' },
    rootRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: scale(24), marginBottom: scale(20) },
    eyebrow: { fontSize: scale(12), color: 'var(--text-secondary)', marginBottom: scale(4), display: 'flex', alignItems: 'center', gap: scale(6) },
    rootPath:{ fontSize: scale(13), color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' },
    bigNum:  { fontSize: scale(26), fontWeight: 500, marginTop: scale(2) },
    bar:     { display: 'flex', height: scale(44), borderRadius: scale(8), overflow: 'hidden', gap: 2, marginBottom: scale(8) },
    seg:     { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: scale(12), overflow: 'hidden', whiteSpace: 'nowrap' },
    barLbl:  { display: 'flex', justifyContent: 'space-between', fontSize: scale(12), color: 'var(--text-secondary)', marginBottom: scale(28) },
    tiles:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(' + scale(190) + 'px, 1fr))', gap: scale(12), marginBottom: scale(28) },
    tile:    { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: scale(12), padding: `${scale(16)}px ${scale(18)}px`, textAlign: 'left', cursor: 'pointer', font: 'inherit' },
    tileNum: { fontSize: scale(22), fontWeight: 500 },
    tileLbl: { fontSize: scale(13), marginTop: scale(2), color: 'var(--text-primary)' },
    tileSub: { fontSize: scale(12), color: 'var(--text-secondary)', marginTop: scale(2) },
    section: { fontSize: scale(13), fontWeight: 500, marginBottom: scale(10) },
    row:     { display: 'flex', alignItems: 'center', gap: scale(10), padding: `${scale(10)}px ${scale(14)}px`, borderBottom: '1px solid var(--border)', fontSize: scale(13) },
    card:    { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: scale(12), overflow: 'hidden', marginBottom: scale(20) },
    path:    { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left', color: 'var(--text-secondary)' },
    note:    { fontSize: scale(12), color: 'var(--text-secondary)', lineHeight: 1.5 },
    meta:    { fontSize: scale(12), color: 'var(--text-secondary)', flexShrink: 0 },
  };
}

// Module-level components, so React keeps them mounted across re-renders.

// Tick: every file here is in the protected source. Half-circle: some aren't.
// Empty ring: none are — the riskiest state.
function Mark({ state, scale }) {
  if (state === 'all') return <CheckCircleIcon size={scale(16)} color="var(--success)" />;
  if (state === 'partial') return <HalfCircleIcon size={scale(16)} color="var(--warning)" />;
  return <span aria-hidden style={{ width: scale(14), height: scale(14), margin: scale(1), borderRadius: '50%', border: '1.5px solid var(--warning)', flexShrink: 0 }} />;
}

function Check({ on, onToggle, label, scale }) {
  return (
    <button role="checkbox" aria-checked={!!on} aria-label={label} onClick={onToggle}
      style={{ width: scale(17), height: scale(17), flexShrink: 0, borderRadius: scale(4),
        border: on ? 'none' : '1px solid var(--border-strong, var(--border))',
        background: on ? 'var(--accent)' : 'transparent', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {on && <span style={{ color: '#fff', fontSize: scale(11), lineHeight: 1 }}>✓</span>}
    </button>
  );
}

function Tile({ num, color, label, sub, onClick, disabled, s }) {
  return (
    <button style={{ ...s.tile, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer' }}
      onClick={disabled ? undefined : onClick}>
      <div style={{ ...s.tileNum, color }}>{num.toLocaleString()}</div>
      <div style={s.tileLbl}>{label}</div>
      <div style={s.tileSub}>{sub}</div>
    </button>
  );
}

// `total` is the true count; `items` may already be capped by the worker.
function FileList({ items, total, emptyText, s }) {
  const shown = items.slice(0, ROW_CAP);
  const more = Math.max(0, (total ?? items.length) - shown.length);
  return (
    <div style={s.card}>
      {shown.length === 0 && <div style={{ ...s.row, borderBottom: 'none', color: 'var(--text-secondary)' }}>{emptyText}</div>}
      {shown.map((f, i) => (
        <div key={f.path} style={{ ...s.row, borderBottom: i === shown.length - 1 && more === 0 ? 'none' : s.row.borderBottom }}>
          <span style={s.path}>{f.path}</span>
          <span style={s.meta}>{formatSize(f.size)}</span>
        </div>
      ))}
      {more > 0 && (
        <div style={{ ...s.row, borderBottom: 'none', color: 'var(--text-secondary)' }}>and {more.toLocaleString()} more</div>
      )}
    </div>
  );
}

export default function CompareView({ scanResult, scanConfig, onReviewFiles, onBack }) {
  const [selFolders, setSelFolders] = useState(() => new Set());
  const { scale } = useDPR();
  const s = useMemo(() => makeStyles(scale), [scale]);
  const [openList, setOpenList] = useState(null);   // 'sourceOnly' | 'targetOnly' | 'unreadable' | null
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [partialAll, setPartialAll] = useState(false);

  const census = scanResult?.census;
  const confidence = scanResult?.confidence || 'standard';
  // Quick matches on name + size only. Its "matched" counts are a guess and
  // its "unmatched" counts include renamed copies — say so wherever they show.
  const isQuick = confidence === 'quick';

  const folders = census?.folders || [];
  const multiRoot = (census?.roots?.target?.paths || []).length > 1;
  const partial = useMemo(() => folders.filter(f => f.state === 'partial'), [folders]);
  const fullyDup = useMemo(() => folders.filter(f => f.state === 'all'), [folders]);
  const noneDup  = useMemo(() => folders.filter(f => f.state === 'none'), [folders]);

  const selectableFolders = useMemo(() => folders.filter(f => f.matched > 0), [folders]);
  const toggleFolder = (key) => setSelFolders(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const selectedFolderObjs = useMemo(
    () => selectableFolders.filter(f => selFolders.has(f.key)),
    [selectableFolders, selFolders]
  );
  const selectedPaths = useMemo(() => selectedFolderObjs.flatMap(f => f.matchedPaths || []), [selectedFolderObjs]);
  const selectedBytes = selectedFolderObjs.reduce((a, f) => a + (f.reclaimable || 0), 0);
  const anyTruncated  = selectedFolderObjs.some(f => f.truncated);

  if (!census) {
    return (
      <div style={{ padding: scale(40), color: 'var(--text-secondary)' }}>
        No comparison summary available for this scan.
      </div>
    );
  }

  const src = census.roots.source;
  const tgt = census.roots.target;
  const unread = census.unreadable || { sourceFiles: 0, targetFiles: 0, list: [] };
  const unreadTotal = unread.sourceFiles + unread.targetFiles;
  const total = Math.max(1, census.sourceOnly.files + census.matched.targetFiles + census.targetOnly.files);
  const pct = n => `${Math.max(2, (n / total) * 100)}%`;
  const matchWord = isQuick ? 'with a same-name match' : 'in source';
  const notWord = isQuick ? 'no name match' : 'not in source';
  const partialShown = partialAll ? partial : partial.slice(0, ROW_CAP);

  return (
    <div style={s.page}>
      <div style={s.rootRow}>
        <div style={{ maxWidth: '44%', minWidth: 0 }}>
          <div style={{ ...s.eyebrow, color: 'var(--accent)' }}>
            <ShieldIcon size={scale(15)} /> Protected source
          </div>
          <div style={s.rootPath}>{src.paths[0] || ''}{src.paths.length > 1 ? ` +${src.paths.length - 1}` : ''}</div>
          <div style={s.bigNum}>{src.files.toLocaleString()}</div>
        </div>
        <div style={{ maxWidth: '44%', minWidth: 0, textAlign: 'right' }}>
          <div style={{ ...s.eyebrow, justifyContent: 'flex-end' }}>Scan target</div>
          <div style={{ ...s.rootPath, direction: 'rtl' }}>{tgt.paths[0] || ''}{tgt.paths.length > 1 ? ` +${tgt.paths.length - 1}` : ''}</div>
          <div style={s.bigNum}>{tgt.files.toLocaleString()}</div>
        </div>
      </div>

      <div style={s.bar}>
        <div style={{ ...s.seg, width: pct(census.sourceOnly.files), background: 'color-mix(in srgb, var(--accent) 26%, transparent)' }} />
        <div style={{ ...s.seg, width: pct(census.matched.targetFiles), background: 'color-mix(in srgb, var(--success) 30%, transparent)', color: 'var(--text-primary)', fontSize: scale(14) }}>
          {census.matched.targetFiles.toLocaleString()} {isQuick ? 'name matches' : 'in both'}
        </div>
        <div style={{ ...s.seg, width: pct(census.targetOnly.files), background: 'color-mix(in srgb, var(--warning) 34%, transparent)' }} />
      </div>
      <div style={s.barLbl}>
        <span>{census.sourceOnly.files.toLocaleString()} only in source</span>
        <span>{isQuick ? 'target-only count needs a standard scan' : `${census.targetOnly.files.toLocaleString()} only in target`}</span>
      </div>

      <div style={s.tiles}>
        <Tile s={s} num={census.sourceOnly.files} color="var(--accent)"
          label="Only in source"
          sub={`${formatSize(census.sourceOnly.bytes)} · not in the target`}
          onClick={() => setOpenList(openList === 'sourceOnly' ? null : 'sourceOnly')} />
        <Tile s={s} num={census.matched.targetFiles} color="var(--success, var(--accent))"
          label={isQuick ? 'Name matches in target' : 'Duplicates in target'}
          sub={isQuick
            ? `${formatSize(census.matched.bytes)} · each checked byte-for-byte before deleting`
            : `${formatSize(census.matched.bytes)} · safe to remove`}
          onClick={() => onReviewFiles(null)} />
        <Tile s={s} num={census.targetOnly.files} color="var(--warning, var(--text-primary))"
          label="Only in target"
          sub={isQuick ? 'needs a standard scan' : `${formatSize(census.targetOnly.bytes)} · not backed up`}
          disabled={isQuick}
          onClick={() => setOpenList(openList === 'targetOnly' ? null : 'targetOnly')} />
      </div>

      {isQuick && (
        <div style={{ ...s.note, marginBottom: scale(24) }}>
          Quick match compares file names and sizes only. A renamed copy looks like a file that isn't backed up,
          and a same-named file with different contents looks like a match. Every deletion is still checked
          byte-for-byte first, but run a standard scan before trusting these numbers.
        </div>
      )}

      {unreadTotal > 0 && (
        <div style={{ ...s.note, marginBottom: scale(24), color: 'var(--warning)' }}>
          {unreadTotal.toLocaleString()} file{unreadTotal !== 1 ? 's' : ''} couldn't be read
          ({unread.sourceFiles.toLocaleString()} in source, {unread.targetFiles.toLocaleString()} in target), so {unreadTotal !== 1 ? 'they are' : 'it is'} not
          counted as matched or unmatched.{' '}
          <button onClick={() => setOpenList(openList === 'unreadable' ? null : 'unreadable')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', font: 'inherit', cursor: 'pointer' }}>
            {openList === 'unreadable' ? 'Hide' : 'Show'} them
          </button>
        </div>
      )}

      {openList === 'targetOnly' && (
        <>
          <div style={s.section}>Files only in the target</div>
          <FileList s={s} items={census.targetOnly.list || []} total={census.targetOnly.files} emptyText="Nothing here — every target file exists in the protected source." />
        </>
      )}
      {openList === 'sourceOnly' && (
        <>
          <div style={s.section}>Files only in the protected source</div>
          <FileList s={s} items={census.sourceOnly.list || []} total={census.sourceOnly.files} emptyText="Nothing here." />
        </>
      )}
      {openList === 'unreadable' && (
        <>
          <div style={s.section}>Files that couldn't be read</div>
          <FileList s={s} items={unread.list || []} total={unreadTotal} emptyText="Nothing here." />
        </>
      )}

      <div style={s.section}>Folders in the target</div>
      <div style={s.card}>
        {partialShown.map((f) => (
          <div key={f.key} style={s.row}>
            <Check scale={scale} on={selFolders.has(f.key)} onToggle={() => toggleFolder(f.key)} label={`Select ${folderLabel(f, multiRoot)}`} />
            <Mark scale={scale} state="partial" />
            <span title={f.root ? `${f.root} › ${f.path}` : f.path} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folderLabel(f, multiRoot)}</span>
            <span style={s.meta}>
              {f.matched.toLocaleString()} of {f.files.toLocaleString()} {matchWord}
            </span>
            <span style={{ ...s.meta, color: isQuick ? 'var(--text-secondary)' : 'var(--warning, var(--text-primary))' }}>
              {f.targetOnly.toLocaleString()} {notWord}
              {f.unreadable > 0 && ` · ${f.unreadable.toLocaleString()} unreadable`}
            </span>
            <span style={{ ...s.meta, minWidth: scale(64), textAlign: 'right' }} title="Space freed by removing the matched files">
              {formatSize(f.reclaimable)}
            </span>
          </div>
        ))}
        {partial.length > ROW_CAP && !partialAll && (
          <button onClick={() => setPartialAll(true)} style={{ ...s.row, width: '100%', background: 'none', border: 'none', borderBottom: s.row.borderBottom, color: 'var(--accent)', font: 'inherit', fontSize: scale(13), cursor: 'pointer' }}>
            Show {(partial.length - ROW_CAP).toLocaleString()} more partly matched folders
          </button>
        )}

        {fullyDup.length > 0 && (
          <>
            <div style={s.row}>
              <Check scale={scale}
                on={fullyDup.every(f => selFolders.has(f.key))}
                onToggle={() => setSelFolders(prev => {
                  const next = new Set(prev);
                  const allOn = fullyDup.every(f => next.has(f.key));
                  fullyDup.forEach(f => (allOn ? next.delete(f.key) : next.add(f.key)));
                  return next;
                })}
                label="Select all fully matched folders" />
              <Mark scale={scale} state="all" />
              <button aria-expanded={foldersOpen} onClick={() => setFoldersOpen(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: scale(10), flex: 1, background: 'none', border: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                {foldersOpen ? <ChevronDownIcon size={scale(14)} /> : <ChevronRightIcon size={scale(14)} />}
                <span style={{ flex: 1 }}>{fullyDup.length.toLocaleString()} folders fully {isQuick ? 'name-matched' : 'duplicated'}</span>
              </button>
              <span style={s.meta}>
                {fullyDup.reduce((a, f) => a + f.files, 0).toLocaleString()} files, all {matchWord}
              </span>
            </div>
            {foldersOpen && fullyDup.slice(0, ROW_CAP).map((f) => (
              <div key={f.key} style={{ ...s.row, paddingLeft: scale(34) }}>
                <Check scale={scale} on={selFolders.has(f.key)} onToggle={() => toggleFolder(f.key)} label={`Select ${folderLabel(f, multiRoot)}`} />
                <Mark scale={scale} state="all" />
                <span title={f.root ? `${f.root} › ${f.path}` : f.path} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{folderLabel(f, multiRoot)}</span>
                <span style={s.meta}>{f.files.toLocaleString()} files · {formatSize(f.bytes)}</span>
              </div>
            ))}
            {foldersOpen && fullyDup.length > ROW_CAP && (
              <div style={{ ...s.row, paddingLeft: scale(34), color: 'var(--text-secondary)' }}>
                and {(fullyDup.length - ROW_CAP).toLocaleString()} more — use the checkbox above to select them all
              </div>
            )}
          </>
        )}

        {noneDup.length > 0 && (
          <div style={{ ...s.row, color: 'var(--text-secondary)' }}>
            <span style={{ width: scale(17), flexShrink: 0 }} />
            <Mark scale={scale} state="none" />
            <span style={{ flex: 1 }}>
              {noneDup.length.toLocaleString()} folders with nothing {isQuick ? 'name-matched' : 'in the source'}
            </span>
            <span style={s.meta}>{noneDup.reduce((a, f) => a + f.files, 0).toLocaleString()} files</span>
          </div>
        )}

        {folders.length === 0 && (
          <div style={{ ...s.row, color: 'var(--text-secondary)' }}>No target folders scanned.</div>
        )}

        {folders.length > 0 && (
          <div style={{ ...s.row, borderBottom: 'none', background: 'var(--bg-inset, transparent)', color: 'var(--text-secondary)', fontSize: scale(12) }}>
            <span style={{ flex: 1 }}>
              {folders.length.toLocaleString()} folders · {census.roots.target.files.toLocaleString()} files in the target
            </span>
            <span style={{ color: 'var(--success)' }}>{census.matched.targetFiles.toLocaleString()} {matchWord}</span>
            {!isQuick && (
              <span style={{ color: census.targetOnly.files > 0 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                {census.targetOnly.files.toLocaleString()} {notWord}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: scale(10), alignItems: 'center', marginTop: scale(4), flexWrap: 'wrap' }}>
        {selectedPaths.length > 0 ? (
          <>
            <button onClick={() => onReviewFiles(selectedPaths, selectedFolderObjs.length === 1
              ? folderLabel(selectedFolderObjs[0], multiRoot)
              : `${selectedFolderObjs.length.toLocaleString()} folders`)}
              style={{ padding: `${scale(9)}px ${scale(16)}px`, borderRadius: scale(8), border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: scale(13), fontWeight: 500, cursor: 'pointer' }}>
              Review {selectedPaths.length.toLocaleString()} selected file{selectedPaths.length === 1 ? '' : 's'}
            </button>
            <button onClick={() => setSelFolders(new Set())}
              style={{ padding: `${scale(9)}px ${scale(16)}px`, borderRadius: scale(8), border: '1px solid var(--border-strong, var(--border))', background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: scale(13), cursor: 'pointer' }}>
              Clear
            </button>
            <span style={s.note}>
              {selectedFolderObjs.length.toLocaleString()} {selectedFolderObjs.length === 1 ? 'folder' : 'folders'} · {formatSize(selectedBytes)} · only matched files are selected
              {anyTruncated && ' · list truncated, review before deleting'}
            </span>
          </>
        ) : (
          <>
            <button onClick={() => onReviewFiles(null)}
              style={{ padding: `${scale(9)}px ${scale(16)}px`, borderRadius: scale(8), border: '1px solid var(--border-strong, var(--border))', background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: scale(13), cursor: 'pointer' }}>
              Review all files
            </button>
            <span style={s.note}>{CONFIDENCE_LABELS[confidence]} · {(scanResult.totalScanned || 0).toLocaleString()} files scanned · tick folders to act on them directly</span>
          </>
        )}
      </div>
    </div>
  );
}
