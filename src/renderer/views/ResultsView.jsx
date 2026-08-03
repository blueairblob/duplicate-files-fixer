import React, { useState, useMemo, useCallback } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import {
  ShieldIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon, ChevronLeftIcon, CheckCircleIcon,
  ImageIcon, FilmIcon, MusicIcon, FileIcon, ArchiveIcon,
} from '../components/icons.jsx';

const api = window.electronAPI;

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function typeIconFor(ext) {
  if (['.jpg','.jpeg','.png','.gif','.heic','.webp','.bmp'].includes(ext)) return ImageIcon;
  if (['.mp4','.mov','.avi','.mkv'].includes(ext)) return FilmIcon;
  if (['.mp3','.aac','.flac','.wav','.m4a'].includes(ext)) return MusicIcon;
  if (['.zip','.rar','.7z'].includes(ext)) return ArchiveIcon;
  return FileIcon;
}

const CONFIDENCE_LABELS = { quick: 'Quick match', standard: 'Standard match', thorough: 'Thorough match' };

export default function ResultsView({ scanResult, scanConfig, onDeleteComplete, onBack, selection = null, backLabel = null }) {
  const { scale } = useDPR();
  const { groups: allGroups = [], totalScanned = 0, mode, warnings = [], confidence = 'thorough' } = scanResult;

  // A selection arriving from the Compare screen scopes this view to the chosen
  // folders and pre-marks exactly those files — the delete path itself is
  // unchanged, so verification and recycle-bin routing behave identically.
  const selSet = useMemo(() => (selection && selection.length ? new Set(selection) : null), [selection]);
  const groups = useMemo(
    () => (selSet ? allGroups.filter(g => g.files.some(f => selSet.has(f.path))) : allGroups),
    [allGroups, selSet]
  );

  // Wording honesty: only a thorough scan has byte-for-byte proven identity.
  const matchWord = confidence === 'thorough' ? 'identical' : 'matching';

  const [marked, setMarked] = useState(() => {
    if (selSet) return new Set(selSet);
    const init = new Set();
    groups.forEach(g => (g.autoMarked || []).forEach(p => init.add(p)));
    return init;
  });
  const [expanded, setExpanded] = useState(() => new Set(groups.map(g => g.id)));
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ackWipeout, setAckWipeout] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g => g.files.some(f =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    ));
  }, [groups, search]);

  const markedCount = marked.size;
  const markedBytes = groups.flatMap(g => g.files)
    .filter(f => marked.has(f.path))
    .reduce((a, f) => a + f.size, 0);

  const noSurvivorGroups = useMemo(
    () => groups.filter(g => g.files.length > 0 && g.files.every(f => marked.has(f.path))),
    [groups, marked]
  );

  const toggleFile = useCallback((path, isProtected) => {
    if (isProtected) return;
    setMarked(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const autoMarkAll = () => {
    const next = new Set();
    groups.forEach(g => (g.autoMarked || []).forEach(p => next.add(p)));
    setMarked(next);
  };
  const deselectAll = () => setMarked(new Set());

  const handleDelete = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    const paths = Array.from(marked);
    // Verify-on-delete: pair every file with a kept copy from its group so the
    // main process can full-hash both immediately before deleting. Applies
    // whenever the scan ran below 'thorough' confidence.
    const needsVerify = confidence !== 'thorough';
    const files = paths.map(p => {
      const group = groups.find(g => g.files.some(f => f.path === p));
      let counterpart = null;
      if (group) {
        const keepers = group.files.filter(f => !marked.has(f.path));
        const protectedKeeper = keepers.find(f => f.sourceLabel === 'protected');
        counterpart = (protectedKeeper || keepers[0])?.path || null;
      }
      return { path: p, counterpart };
    });
    let result;
    if (api) {
      result = await api.deleteFiles({ files, verify: needsVerify });
    } else {
      await new Promise(r => setTimeout(r, 800));
      result = { deleted: paths, failed: [] };
    }
    onDeleteComplete({ ...result, markedBytes, totalScanned });
  };

  const btnSecondary = {
    background: 'var(--bg-card)', color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
    padding: `${scale(7)}px ${scale(14)}px`, fontSize: 'var(--fs-secondary)',
  };

  // ── Empty state ──
  if (groups.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: scale(14) }}>
        <CheckCircleIcon size={scale(44)} color="var(--success)" />
        <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 500 }}>No duplicates found</h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
          Scanned {totalScanned.toLocaleString()} files — everything looks clean.
        </p>
        {warnings.length > 0 && (
          <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--warning)' }}>
            {warnings.length} item{warnings.length !== 1 ? 's' : ''} could not be read and {warnings.length !== 1 ? 'were' : 'was'} skipped.
          </p>
        )}
        <button onClick={onBack} style={{
          background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: 'var(--radius-sm)',
          fontWeight: 500, fontSize: 'var(--fs-body)', padding: `${scale(9)}px ${scale(24)}px`, marginTop: scale(8),
        }}>{backLabel ? `Back to ${backLabel}` : 'Scan again'}</button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Toolbar ── */}
      <div style={{
        padding: `${scale(14)}px ${scale(24)}px`,
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: scale(14), flexShrink: 0,
      }}>
        {backLabel && (
          <button onClick={onBack} title={`Back to ${backLabel}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: scale(4), flexShrink: 0,
            background: 'none', border: 'none', cursor: 'pointer', padding: `${scale(5)}px ${scale(8)}px`,
            marginLeft: scale(-8), borderRadius: scale(6),
            color: 'var(--accent)', fontFamily: 'inherit', fontSize: 'var(--fs-body)',
          }}>
            <ChevronLeftIcon size={scale(16)} /> {backLabel}
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--fs-heading)', fontWeight: 600, margin: 0 }}>
            {groups.length.toLocaleString()} duplicate group{groups.length !== 1 ? 's' : ''}
          </h1>
          <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)', margin: 0 }}>
            {selSet
              ? `Showing your selection · ${selSet.size.toLocaleString()} files`
              : `${totalScanned.toLocaleString()} files scanned`
            } · {CONFIDENCE_LABELS[confidence] || 'Thorough match'}
            {confidence !== 'thorough' && ' · deletions verified first'}
          </p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: scale(8) }}>
          {mode === 'compare' && (
            <span title="Files in the protected source can never be deleted" style={{
              display: 'inline-flex', alignItems: 'center', gap: scale(5),
              fontSize: 'var(--fs-caption)', color: 'var(--accent)',
              background: 'var(--accent-tint)', borderRadius: scale(12),
              padding: `${scale(3)}px ${scale(10)}px`,
            }}>
              <ShieldIcon size={scale(13)} /> Protected source
            </span>
          )}
          <div style={{ position: 'relative' }}>
            <SearchIcon size={scale(14)} color="var(--text-muted)" style={{ position: 'absolute', left: scale(9), top: '50%', transform: 'translateY(-50%)' }} />
            <input
              placeholder="Search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                background: 'var(--bg-inset)', border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                padding: `${scale(6)}px ${scale(10)}px ${scale(6)}px ${scale(28)}px`,
                fontSize: 'var(--fs-secondary)', width: scale(180),
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Groups */}
        <div style={{ flex: 1, overflowY: 'auto', padding: `${scale(16)}px ${scale(24)}px` }}>
          {filteredGroups.map(group => {
            const isExpanded = expanded.has(group.id);
            const groupMarked = group.files.filter(f => marked.has(f.path)).length;
            const TypeIcon = typeIconFor(group.files[0].ext);

            return (
              <div key={group.id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', marginBottom: scale(10), overflow: 'hidden',
              }}>
                {/* Group header */}
                <button
                  onClick={() => setExpanded(prev => {
                    const next = new Set(prev);
                    next.has(group.id) ? next.delete(group.id) : next.add(group.id);
                    return next;
                  })}
                  style={{
                    width: '100%', textAlign: 'left', background: 'transparent',
                    padding: `${scale(10)}px ${scale(14)}px`,
                    display: 'flex', alignItems: 'center', gap: scale(10),
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <TypeIcon size={scale(17)} color="var(--text-secondary)" />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{
                      display: 'block', fontSize: 'var(--fs-secondary)', fontWeight: 500,
                      color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{group.files[0].name}</span>
                    <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)' }}>
                      {group.files.length} {matchWord} copies · {formatSize(group.files[0].size)} each
                    </span>
                  </span>
                  {groupMarked > 0 && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--danger)', flexShrink: 0 }}>
                      {groupMarked} selected
                    </span>
                  )}
                  {isExpanded
                    ? <ChevronDownIcon size={scale(14)} color="var(--text-muted)" />
                    : <ChevronRightIcon size={scale(14)} color="var(--text-muted)" />}
                </button>

                {/* File rows */}
                {isExpanded && group.files.map(file => {
                  const isProtected = file.sourceLabel === 'protected';
                  const isMarked = marked.has(file.path);

                  return (
                    <div
                      key={file.path}
                      onClick={() => toggleFile(file.path, isProtected)}
                      style={{
                        padding: `${scale(8)}px ${scale(14)}px`,
                        display: 'flex', alignItems: 'center', gap: scale(11),
                        borderTop: '1px solid var(--border)',
                        cursor: isProtected ? 'default' : 'pointer',
                      }}
                      onMouseEnter={e => { if (!isProtected) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {isProtected ? (
                        <span title="Protected — can never be deleted" style={{ display: 'flex', flexShrink: 0 }}>
                          <ShieldIcon size={scale(16)} color="var(--accent)" />
                        </span>
                      ) : (
                        <span style={{
                          width: scale(16), height: scale(16), borderRadius: scale(4), flexShrink: 0,
                          border: `1.5px solid ${isMarked ? 'var(--danger)' : 'var(--border-strong)'}`,
                          background: isMarked ? 'var(--danger)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'background 0.1s ease, border-color 0.1s ease',
                        }}>
                          {isMarked && <span style={{ color: '#fff', fontSize: scale(10), lineHeight: 1 }}>✓</span>}
                        </span>
                      )}

                      <span title={file.path} style={{
                        flex: 1, minWidth: 0, fontSize: 'var(--fs-caption)',
                        color: isMarked ? 'var(--danger)' : 'var(--text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        direction: 'rtl', textAlign: 'left',
                      }}>{file.path}</span>

                      {isProtected && (
                        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--accent)', flexShrink: 0 }}>
                          Protected
                        </span>
                      )}
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', flexShrink: 0, textAlign: 'right', minWidth: scale(120) }}>
                        {formatSize(file.size)} · {formatDate(file.modified)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Skipped-during-scan warnings */}
          {warnings.length > 0 && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', marginTop: scale(6), overflow: 'hidden',
            }}>
              <button
                onClick={() => setWarningsOpen(v => !v)}
                style={{
                  width: '100%', textAlign: 'left', background: 'transparent',
                  padding: `${scale(10)}px ${scale(14)}px`,
                  display: 'flex', alignItems: 'center', gap: scale(8),
                }}
              >
                <span style={{ fontSize: 'var(--fs-secondary)', color: 'var(--warning)', flex: 1 }}>
                  {warnings.length} file{warnings.length !== 1 ? 's' : ''} could not be read during the scan
                </span>
                {warningsOpen
                  ? <ChevronDownIcon size={scale(14)} color="var(--text-muted)" />
                  : <ChevronRightIcon size={scale(14)} color="var(--text-muted)" />}
              </button>
              {warningsOpen && (
                <div style={{ maxHeight: scale(200), overflowY: 'auto' }}>
                  {warnings.map((w, i) => (
                    <div key={i} style={{
                      padding: `${scale(7)}px ${scale(14)}px`, borderTop: '1px solid var(--border)',
                      display: 'flex', justifyContent: 'space-between', gap: scale(12),
                    }}>
                      <span style={{
                        fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        direction: 'rtl', textAlign: 'left', flex: 1,
                      }}>{w.path}</span>
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--warning)', flexShrink: 0 }}>{w.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Action panel ── */}
        <div style={{
          width: scale(230), flexShrink: 0,
          borderLeft: '1px solid var(--border)', padding: scale(20),
          display: 'flex', flexDirection: 'column', gap: scale(16),
        }}>
          <div>
            <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)', margin: 0 }}>Selected for deletion</p>
            <p style={{
              fontSize: scale(28), fontWeight: 500, margin: `${scale(2)}px 0 0`,
              color: markedCount > 0 ? 'var(--danger)' : 'var(--text-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}>{markedCount.toLocaleString()}</p>
            <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)', margin: 0 }}>
              {formatSize(markedBytes)} will be freed
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: scale(7) }}>
            <button onClick={autoMarkAll} style={btnSecondary}>Auto-select duplicates</button>
            <button onClick={deselectAll} style={btnSecondary}>Deselect all</button>
          </div>

          <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
            {mode === 'compare' && 'Protected files can never be deleted. '}
            Deleted files go to the Recycle Bin{confidence !== 'thorough' && ' and are verified byte-for-byte first'}.
          </p>

          <button
            onClick={() => { if (markedCount > 0) { setAckWipeout(false); setConfirmOpen(true); } }}
            disabled={markedCount === 0 || deleting}
            style={{
              marginTop: 'auto', width: '100%',
              background: 'var(--danger)', color: '#fff',
              borderRadius: 'var(--radius-sm)', fontWeight: 500,
              fontSize: 'var(--fs-body)', padding: `${scale(10)}px ${scale(16)}px`,
              opacity: markedCount === 0 ? 0.4 : 1,
              cursor: markedCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {deleting ? 'Deleting…' : `Delete ${markedCount.toLocaleString()} file${markedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* ── Confirm modal ── */}
      {confirmOpen && (
        <div
          onClick={() => setConfirmOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sheet)',
            padding: scale(24), width: scale(400), maxWidth: '90vw',
          }}>
            <h2 style={{ fontSize: 'var(--fs-heading)', fontWeight: 600, marginBottom: scale(6) }}>
              Delete {markedCount.toLocaleString()} file{markedCount !== 1 ? 's' : ''}?
            </h2>
            <p style={{ fontSize: 'var(--fs-secondary)', color: 'var(--text-secondary)', marginBottom: scale(16) }}>
              {formatSize(markedBytes)} will be moved to the Recycle Bin
              {confidence !== 'thorough' && ', after verifying each file still matches its kept copy'}.
            </p>

            {noSurvivorGroups.length > 0 && (
              <div style={{
                background: 'var(--danger-tint)', borderRadius: 'var(--radius-sm)',
                padding: `${scale(12)}px ${scale(14)}px`, marginBottom: scale(16),
              }}>
                <p style={{ fontSize: 'var(--fs-secondary)', color: 'var(--danger)', fontWeight: 500, marginBottom: scale(4) }}>
                  No copy will remain
                </p>
                <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: scale(10) }}>
                  {noSurvivorGroups.length} group{noSurvivorGroups.length !== 1 ? 's have' : ' has'} every copy selected —
                  after this delete there will be no remaining copy of {noSurvivorGroups.length !== 1 ? 'those files' : 'that file'}.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: scale(8), cursor: 'pointer' }}>
                  <input type="checkbox" checked={ackWipeout} onChange={e => setAckWipeout(e.target.checked)} />
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-primary)' }}>
                    I understand this removes the only remaining copies
                  </span>
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: scale(10), justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmOpen(false)} style={btnSecondary}>Cancel</button>
              <button
                onClick={handleDelete}
                disabled={noSurvivorGroups.length > 0 && !ackWipeout}
                style={{
                  background: 'var(--danger)', color: '#fff',
                  borderRadius: 'var(--radius-sm)', fontWeight: 500,
                  fontSize: 'var(--fs-secondary)', padding: `${scale(8)}px ${scale(18)}px`,
                  opacity: (noSurvivorGroups.length > 0 && !ackWipeout) ? 0.4 : 1,
                  cursor: (noSurvivorGroups.length > 0 && !ackWipeout) ? 'not-allowed' : 'pointer',
                }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
