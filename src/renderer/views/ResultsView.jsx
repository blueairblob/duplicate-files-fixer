import React, { useState, useMemo, useCallback } from 'react';

const api = window.electronAPI;

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fileIcon(ext) {
  const map = {
    '.jpg': '🖼', '.jpeg': '🖼', '.png': '🖼', '.gif': '🖼', '.heic': '🖼', '.webp': '🖼',
    '.mp3': '🎵', '.aac': '🎵', '.flac': '🎵', '.wav': '🎵', '.m4a': '🎵',
    '.mp4': '🎬', '.mov': '🎬', '.avi': '🎬', '.mkv': '🎬',
    '.pdf': '📄', '.docx': '📝', '.xlsx': '📊', '.pptx': '📑', '.txt': '📃',
    '.zip': '📦', '.rar': '📦', '.7z': '📦',
    '.eml': '📧',
  };
  return map[ext] || '📄';
}

export default function ResultsView({ scanResult, onDeleteComplete, onBack }) {
  const { groups, totalScanned } = scanResult;

  // marked = set of file paths selected for deletion
  const [marked, setMarked] = useState(() => {
    const init = new Set();
    groups.forEach(g => {
      // Auto-mark: keep the newest file, mark rest
      const sorted = [...g.files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
      sorted.slice(1).forEach(f => init.add(f.path));
    });
    return init;
  });

  const [expanded, setExpanded] = useState(() => new Set(groups.map(g => g.id)));
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(g => g.files.some(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)));
  }, [groups, search]);

  const totalDupes = groups.reduce((a, g) => a + g.files.length - 1, 0);
  const markedCount = marked.size;
  const markedBytes = groups.flatMap(g => g.files).filter(f => marked.has(f.path)).reduce((a, f) => a + f.size, 0);

  const toggleFile = useCallback((path) => {
    setMarked(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const autoMarkAll = () => {
    const next = new Set();
    groups.forEach(g => {
      const sorted = [...g.files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
      sorted.slice(1).forEach(f => next.add(f.path));
    });
    setMarked(next);
  };

  const selectAll = () => {
    const next = new Set();
    groups.forEach(g => g.files.forEach(f => next.add(f.path)));
    setMarked(next);
  };

  const deselectAll = () => setMarked(new Set());

  const handleDelete = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    const paths = Array.from(marked);
    let result;
    if (api) {
      result = await api.deleteFiles(paths);
    } else {
      // Demo mode
      await new Promise(r => setTimeout(r, 800));
      result = { deleted: paths, failed: [] };
    }
    onDeleteComplete({ ...result, markedBytes, totalScanned });
  };

  if (groups.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>✅</div>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>No duplicates found</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Scanned {totalScanned.toLocaleString()} files — everything looks clean.</p>
        <button onClick={onBack} style={btnPrimary}>Scan again</button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar ── */}
      <div style={{
        padding: '14px 24px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ ...btnGhost, color: 'var(--text-muted)', fontSize: 18, padding: '0 6px' }}>←</button>

        <div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{groups.length} duplicate groups</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 10 }}>
            {totalDupes} redundant files · scanned {totalScanned.toLocaleString()} total
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            placeholder="Search files…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              fontSize: 12, width: 200,
            }}
          />
          <button onClick={autoMarkAll} style={btnSecondary}>Auto-mark</button>
          <button onClick={deselectAll} style={btnSecondary}>Deselect all</button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Groups list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {filteredGroups.map((group) => {
            const isExpanded = expanded.has(group.id);
            const groupMarkedCount = group.files.filter(f => marked.has(f.path)).length;

            return (
              <div key={group.id} style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 10,
                overflow: 'hidden',
              }}>
                {/* Group header */}
                <div
                  onClick={() => setExpanded(prev => {
                    const next = new Set(prev);
                    next.has(group.id) ? next.delete(group.id) : next.add(group.id);
                    return next;
                  })}
                  style={{
                    padding: '10px 16px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    cursor: 'pointer', background: 'var(--bg-elevated)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                >
                  <span style={{ fontSize: 16 }}>{fileIcon(group.files[0].ext)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                    {group.hash.substring(0, 8)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {group.files.length} identical files · {formatSize(group.files[0].size)} each
                  </span>
                  {groupMarkedCount > 0 && (
                    <span style={{
                      marginLeft: 'auto', marginRight: 8,
                      background: 'var(--red-dim)', color: 'var(--red)',
                      border: '1px solid var(--red)',
                      borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 600,
                    }}>
                      {groupMarkedCount} marked
                    </span>
                  )}
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: groupMarkedCount > 0 ? 0 : 'auto' }}>
                    {isExpanded ? '▾' : '▸'}
                  </span>
                </div>

                {/* Files */}
                {isExpanded && group.files.map((file, i) => {
                  const isMarked = marked.has(file.path);
                  return (
                    <div
                      key={file.path}
                      onClick={() => toggleFile(file.path)}
                      style={{
                        padding: '9px 16px',
                        display: 'flex', alignItems: 'center', gap: 12,
                        borderTop: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: isMarked ? 'var(--red-dim)' : 'transparent',
                        transition: 'background 0.1s ease',
                      }}
                      onMouseEnter={e => { if (!isMarked) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={e => { if (!isMarked) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${isMarked ? 'var(--red)' : 'var(--border-light)'}`,
                        background: isMarked ? 'var(--red)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isMarked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: isMarked ? 'var(--red)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {file.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {file.path}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatSize(file.size)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatDate(file.modified)}</div>
                      </div>

                      {i === 0 && (
                        <div style={{
                          background: 'var(--teal-dim)', color: 'var(--teal)',
                          border: '1px solid var(--teal)',
                          borderRadius: 4, padding: '1px 7px', fontSize: 9, fontWeight: 600, flexShrink: 0,
                        }}>NEWEST</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── Right action panel ── */}
        <div style={{
          width: 220, flexShrink: 0,
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 20,
        }}>
          <div>
            <p style={labelStyle}>Selected for deletion</p>
            <div style={{ fontSize: 28, fontWeight: 700, color: markedCount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
              {markedCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {formatSize(markedBytes)} will be freed
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)' }}/>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={autoMarkAll} style={{ ...btnSecondary, textAlign: 'left', width: '100%' }}>
              ⚡ Auto-mark duplicates
            </button>
            <button onClick={selectAll} style={{ ...btnSecondary, textAlign: 'left', width: '100%' }}>
              ☑ Select all files
            </button>
            <button onClick={deselectAll} style={{ ...btnSecondary, textAlign: 'left', width: '100%' }}>
              ☐ Deselect all
            </button>
          </div>

          <div style={{ height: 1, background: 'var(--border)' }}/>

          <div style={{ background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
            <p style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600, marginBottom: 4 }}>⚠ Safe deletion</p>
            <p style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Deleted files are sent to the Recycle Bin. You can recover them if needed.
            </p>
          </div>

          <button
            onClick={() => markedCount > 0 && setConfirmOpen(true)}
            disabled={markedCount === 0 || deleting}
            style={{
              ...btnDanger,
              marginTop: 'auto',
              opacity: markedCount === 0 ? 0.4 : 1,
              cursor: markedCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {deleting ? 'Deleting…' : `Delete ${markedCount} file${markedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* ── Confirm dialog ── */}
      {confirmOpen && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 28, width: 360,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Confirm deletion</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              {markedCount} file{markedCount !== 1 ? 's' : ''} ({formatSize(markedBytes)}) will be moved to the Recycle Bin.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmOpen(false)} style={btnSecondary}>Cancel</button>
              <button onClick={handleDelete} style={btnDanger}>Delete marked</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 };

const btnPrimary = { background: 'var(--teal)', color: '#0d0f14', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const btnSecondary = { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '7px 12px', fontSize: 11, cursor: 'pointer' };
const btnDanger = { background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '10px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' };
const btnGhost = { background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-muted)' };
