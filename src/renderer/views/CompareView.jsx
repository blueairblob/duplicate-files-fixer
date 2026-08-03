import React, { useState, useMemo } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { ShieldIcon, ChevronRightIcon, ChevronDownIcon } from '../components/icons.jsx';

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const CONFIDENCE_LABELS = { quick: 'Quick match', standard: 'Standard match', thorough: 'Thorough match' };

function lastSegment(p) {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export default function CompareView({ scanResult, scanConfig, onReviewFiles, onBack }) {
  const [selFolders, setSelFolders] = useState(() => new Set());
  const { scale } = useDPR();
  const [openList, setOpenList] = useState(null);   // 'sourceOnly' | 'targetOnly' | null
  const [foldersOpen, setFoldersOpen] = useState(false);

  const census = scanResult?.census;
  const confidence = scanResult?.confidence || 'standard';
  const isQuick = confidence === 'quick';

  const folders = census?.folders || [];
  const partial = useMemo(() => folders.filter(f => f.state === 'partial'), [folders]);
  const fullyDup = useMemo(() => folders.filter(f => f.state === 'all'), [folders]);
  const noneDup  = useMemo(() => folders.filter(f => f.state === 'none'), [folders]);

  const selectableFolders = useMemo(
    () => (census?.folders || []).filter(f => f.matched > 0),
    [census]
  );
  const toggleFolder = (key) => setSelFolders(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const selectedFolderObjs = useMemo(
    () => selectableFolders.filter(f => selFolders.has(f.path)),
    [selectableFolders, selFolders]
  );
  const selectedPaths = useMemo(
    () => selectedFolderObjs.flatMap(f => f.matchedPaths || []),
    [selectedFolderObjs]
  );
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
  const total = Math.max(1, census.sourceOnly.files + census.matched.targetFiles + census.targetOnly.files);
  const pct = n => `${Math.max(2, (n / total) * 100)}%`;

  const s = {
    page:    { padding: `${scale(28)}px ${scale(32)}px`, overflowY: 'auto', height: '100%' },
    rootRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: scale(24), marginBottom: scale(20) },
    eyebrow: { fontSize: scale(12), color: 'var(--text-secondary)', marginBottom: scale(4), display: 'flex', alignItems: 'center', gap: scale(6) },
    rootPath:{ fontSize: scale(13), color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' },
    bigNum:  { fontSize: scale(26), fontWeight: 500, marginTop: scale(2) },
    bar:     { display: 'flex', height: scale(44), borderRadius: scale(8), overflow: 'hidden', gap: 2, marginBottom: scale(8) },
    seg:     { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: scale(12), overflow: 'hidden', whiteSpace: 'nowrap' },
    barLbl:  { display: 'flex', justifyContent: 'space-between', fontSize: scale(12), color: 'var(--text-tertiary, var(--text-secondary))', marginBottom: scale(28) },
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
  };

  const Check = ({ on, onToggle, label }) => (
    <button aria-label={label} onClick={onToggle}
      style={{ width: scale(17), height: scale(17), flexShrink: 0, borderRadius: scale(4),
        border: on ? 'none' : '1px solid var(--border-strong, var(--border))',
        background: on ? 'var(--accent)' : 'transparent', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {on && <span style={{ color: '#fff', fontSize: scale(11), lineHeight: 1 }}>✓</span>}
    </button>
  );

  const Tile = ({ num, color, label, sub, onClick, disabled }) => (
    <button style={{ ...s.tile, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer' }}
      onClick={disabled ? undefined : onClick}>
      <div style={{ ...s.tileNum, color }}>{num.toLocaleString()}</div>
      <div style={s.tileLbl}>{label}</div>
      <div style={s.tileSub}>{sub}</div>
    </button>
  );

  const FileList = ({ items, emptyText }) => (
    <div style={s.card}>
      {items.length === 0 && <div style={{ ...s.row, borderBottom: 'none', color: 'var(--text-secondary)' }}>{emptyText}</div>}
      {items.slice(0, 300).map((f, i) => (
        <div key={i} style={{ ...s.row, borderBottom: i === Math.min(items.length, 300) - 1 ? 'none' : '1px solid var(--border)' }}>
          <span style={s.path}>{f.path}</span>
          <span style={{ fontSize: scale(12), color: 'var(--text-secondary)', flexShrink: 0 }}>{formatSize(f.size)}</span>
        </div>
      ))}
      {items.length > 300 && (
        <div style={{ ...s.row, borderBottom: 'none', color: 'var(--text-secondary)' }}>
          and {(items.length - 300).toLocaleString()} more
        </div>
      )}
    </div>
  );

  return (
    <div style={s.page}>
      <div style={s.rootRow}>
        <div style={{ maxWidth: '44%', minWidth: 0 }}>
          <div style={{ ...s.eyebrow, color: 'var(--accent)' }}>
            <ShieldIcon size={scale(15)} /> Protected source
          </div>
          <div style={s.rootPath}>{src.paths[0] || ''}</div>
          <div style={s.bigNum}>{src.files.toLocaleString()}</div>
        </div>
        <div style={{ maxWidth: '44%', minWidth: 0, textAlign: 'right' }}>
          <div style={{ ...s.eyebrow, justifyContent: 'flex-end' }}>Scan target</div>
          <div style={{ ...s.rootPath, direction: 'rtl' }}>{tgt.paths[0] || ''}</div>
          <div style={s.bigNum}>{tgt.files.toLocaleString()}</div>
        </div>
      </div>

      <div style={s.bar}>
        <div style={{ ...s.seg, width: pct(census.sourceOnly.files), background: 'color-mix(in srgb, var(--accent) 26%, transparent)' }} />
        <div style={{ ...s.seg, width: pct(census.matched.targetFiles), background: 'color-mix(in srgb, var(--success) 30%, transparent)', color: 'var(--text-primary)', fontSize: scale(14) }}>
          {census.matched.targetFiles.toLocaleString()} in both
        </div>
        <div style={{ ...s.seg, width: pct(census.targetOnly.files), background: 'color-mix(in srgb, var(--warning) 34%, transparent)' }} />
      </div>
      <div style={s.barLbl}>
        <span>{census.sourceOnly.files.toLocaleString()} only in source</span>
        <span>{census.targetOnly.files.toLocaleString()} only in target</span>
      </div>

      <div style={s.tiles}>
        <Tile num={census.matched.targetFiles} color="var(--success, var(--accent))"
          label="Duplicates in target"
          sub={`${formatSize(census.matched.bytes)} · safe to remove`}
          onClick={() => onReviewFiles(null)} />
        <Tile num={census.targetOnly.files} color="var(--warning, var(--text-primary))"
          label="Only in target"
          sub={isQuick ? 'needs a standard scan' : `${formatSize(census.targetOnly.bytes)} · not backed up`}
          disabled={isQuick}
          onClick={() => setOpenList(openList === 'targetOnly' ? null : 'targetOnly')} />
        <Tile num={census.sourceOnly.files} color="var(--accent)"
          label="Only in source"
          sub={`${formatSize(census.sourceOnly.bytes)} · not in the target`}
          onClick={() => setOpenList(openList === 'sourceOnly' ? null : 'sourceOnly')} />
      </div>

      {isQuick && (
        <div style={{ ...s.note, marginBottom: scale(24) }}>
          Quick match compares file names and sizes only, so a copy that was renamed looks like a
          file that isn't backed up. Run a standard scan before trusting the “only in target” count.
        </div>
      )}

      {openList === 'targetOnly' && (
        <>
          <div style={s.section}>Files only in the target</div>
          <FileList items={census.targetOnly.list || []} emptyText="Nothing here — every target file exists in the protected source." />
        </>
      )}
      {openList === 'sourceOnly' && (
        <>
          <div style={s.section}>Files only in the protected source</div>
          <FileList items={census.sourceOnly.list || []} emptyText="Nothing here." />
        </>
      )}

      <div style={s.section}>Folders</div>
      <div style={s.card}>
        {partial.map((f, i) => (
          <div key={'p' + i} style={s.row}>
            <Check on={selFolders.has(f.path)} onToggle={() => toggleFolder(f.path)} label={`Select ${f.path}`} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastSegment(f.path)}</span>
            <span style={{ fontSize: scale(12), color: 'var(--warning, var(--text-primary))', flexShrink: 0 }}>
              {f.matched} of {f.files} duplicated
            </span>
            <span style={{ fontSize: scale(12), color: 'var(--text-secondary)', flexShrink: 0, minWidth: scale(64), textAlign: 'right' }}>
              {formatSize(f.bytes)}
            </span>
          </div>
        ))}

        {fullyDup.length > 0 && (
          <>
            <div style={{ ...s.row, borderBottom: foldersOpen ? '1px solid var(--border)' : 'none' }}>
              <Check
                on={fullyDup.length > 0 && fullyDup.every(f => selFolders.has(f.path))}
                onToggle={() => setSelFolders(prev => {
                  const next = new Set(prev);
                  const allOn = fullyDup.every(f => next.has(f.path));
                  fullyDup.forEach(f => (allOn ? next.delete(f.path) : next.add(f.path)));
                  return next;
                })}
                label="Select all fully duplicated folders" />
              <button onClick={() => setFoldersOpen(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: scale(10), flex: 1, background: 'none', border: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                {foldersOpen ? <ChevronDownIcon size={scale(14)} /> : <ChevronRightIcon size={scale(14)} />}
                <span style={{ flex: 1 }}>{fullyDup.length.toLocaleString()} folders fully duplicated</span>
              </button>
              <span style={{ fontSize: scale(12), color: 'var(--text-secondary)' }}>
                {fullyDup.reduce((a, f) => a + f.files, 0).toLocaleString()} files
              </span>
            </div>
            {foldersOpen && fullyDup.slice(0, 300).map((f, i) => (
              <div key={'a' + i} style={{ ...s.row, paddingLeft: scale(34) }}>
                <Check on={selFolders.has(f.path)} onToggle={() => toggleFolder(f.path)} label={`Select ${f.path}`} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{lastSegment(f.path)}</span>
                <span style={{ fontSize: scale(12), color: 'var(--text-secondary)' }}>{f.files} files · {formatSize(f.bytes)}</span>
              </div>
            ))}
          </>
        )}

        {noneDup.length > 0 && (
          <div style={{ ...s.row, borderBottom: 'none', color: 'var(--text-secondary)' }}>
            <span style={{ flex: 1 }}>{noneDup.length.toLocaleString()} folders with nothing duplicated</span>
          </div>
        )}

        {folders.length === 0 && (
          <div style={{ ...s.row, borderBottom: 'none', color: 'var(--text-secondary)' }}>No target folders scanned.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: scale(10), alignItems: 'center', marginTop: scale(4), flexWrap: 'wrap' }}>
        {selectedPaths.length > 0 ? (
          <>
            <button onClick={() => onReviewFiles(selectedPaths, selectedFolderObjs.length === 1
              ? lastSegment(selectedFolderObjs[0].path)
              : `${selectedFolderObjs.length.toLocaleString()} folders`)}
              style={{ padding: `${scale(9)}px ${scale(16)}px`, borderRadius: scale(8), border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: scale(13), fontWeight: 500, cursor: 'pointer' }}>
              Review {selectedPaths.length.toLocaleString()} selected file{selectedPaths.length === 1 ? '' : 's'}
            </button>
            <button onClick={() => setSelFolders(new Set())}
              style={{ padding: `${scale(9)}px ${scale(16)}px`, borderRadius: scale(8), border: '1px solid var(--border-strong, var(--border))', background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: scale(13), cursor: 'pointer' }}>
              Clear
            </button>
            <span style={s.note}>
              {selectedFolderObjs.length.toLocaleString()} {selectedFolderObjs.length === 1 ? 'folder' : 'folders'} · {formatSize(selectedBytes)}
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
