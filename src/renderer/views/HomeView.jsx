import React, { useState, useCallback } from 'react';

const api = window.electronAPI;

const FILE_TYPES = [
  { id: 'photos',   label: 'Photos',    icon: '🖼' },
  { id: 'audio',    label: 'Audio',     icon: '🎵' },
  { id: 'video',    label: 'Video',     icon: '🎬' },
  { id: 'docs',     label: 'Documents', icon: '📄' },
  { id: 'archives', label: 'Archives',  icon: '📦' },
];

const SIZE_OPTIONS = [
  { label: 'Any size',   value: 0 },
  { label: '> 100 KB',  value: 102400 },
  { label: '> 1 MB',    value: 1048576 },
  { label: '> 10 MB',   value: 10485760 },
  { label: '> 100 MB',  value: 104857600 },
];

const AUTO_MARK_RULES = [
  { id: 'protected-wins', label: 'Protected source wins', desc: 'Targets duplicating protected files are always marked' },
  { id: 'keep-newest',    label: 'Keep newest',           desc: 'Among unprotected dupes, keep most recently modified' },
  { id: 'keep-oldest',    label: 'Keep oldest',           desc: 'Among unprotected dupes, keep earliest modified' },
  { id: 'keep-largest',   label: 'Keep largest',          desc: 'Keep the highest-size copy (useful for media)' },
];

// ── Reusable folder drop zone ─────────────────────────────────────────────────
function FolderZone({ label, sublabel, accent, folders, onAdd, onRemove }) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files)
      .filter(f => f.type === '')
      .map(f => f.path)
      .filter(Boolean);
    if (dropped.length) onAdd(dropped);
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: accent, flexShrink: 0,
        }}/>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sublabel}</span>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragging ? accent : 'var(--border-light)'}`,
          borderRadius: 'var(--radius-md)',
          padding: folders.length === 0 ? 20 : 12,
          background: dragging
            ? `${accent}10`
            : folders.length > 0 ? 'var(--bg-elevated)' : 'transparent',
          transition: 'all 0.15s ease',
          minHeight: 90,
        }}
      >
        {folders.length === 0 ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Drop folders here, or
            </p>
            <button onClick={onAdd} style={{ ...btnSecondary, borderColor: accent, color: accent }}>
              + Browse
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {folders.map(f => (
              <div key={f} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <span style={{ fontSize: 12 }}>📂</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: 'var(--text-secondary)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{f}</span>
                <button
                  onClick={() => onRemove(f)}
                  style={{ ...btnGhost, fontSize: 10, color: 'var(--red)', flexShrink: 0 }}
                >✕</button>
              </div>
            ))}
            <button onClick={onAdd} style={{ ...btnGhost, fontSize: 11, color: accent, marginTop: 2, textAlign: 'left' }}>
              + Add folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main HomeView ─────────────────────────────────────────────────────────────
export default function HomeView({ onStartScan }) {
  const [mode, setMode] = useState('compare'); // 'simple' | 'compare'
  const [protectedFolders, setProtectedFolders] = useState([]);
  const [targetFolders, setTargetFolders] = useState([]);
  const [simpleFolders, setSimpleFolders] = useState([]);
  const [types, setTypes] = useState([]);
  const [minSize, setMinSize] = useState(0);
  const [autoMarkRule, setAutoMarkRule] = useState('protected-wins');

  const pickFolders = useCallback(async () => {
    if (!api) return [];
    const paths = await api.openFolder();
    return paths;
  }, []);

  const addToZone = async (setter) => {
    const paths = await pickFolders();
    if (paths.length) setter(prev => [...new Set([...prev, ...paths])]);
  };

  const addDropped = (setter, paths) => {
    setter(prev => [...new Set([...prev, ...paths])]);
  };

  const toggleType = (id) =>
    setTypes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const canScan = mode === 'compare'
    ? protectedFolders.length > 0 && targetFolders.length > 0
    : simpleFolders.length > 0;

  const handleStartScan = () => {
    if (!canScan) return;
    onStartScan({
      mode,
      protectedFolders: mode === 'compare' ? protectedFolders : [],
      targetFolders: mode === 'compare' ? targetFolders : simpleFolders,
      filters: { types, minSize },
      autoMarkRule,
    });
  };

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 210, flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        padding: '28px 20px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 18 }}>HOW IT WORKS</p>
        {[
          { n: '01', title: 'Choose a mode',   desc: 'Simple scan or compare two locations' },
          { n: '02', title: 'Add folders',      desc: 'Protected source + target to clean' },
          { n: '03', title: 'Set rules',        desc: 'Control what gets auto-marked' },
          { n: '04', title: 'Scan & review',    desc: 'Delete with confidence' },
        ].map(({ n, title, desc }, i) => (
          <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: i === 0 ? 'var(--teal-dim)' : 'transparent',
              border: `1.5px solid ${i === 0 ? 'var(--teal)' : 'var(--border-light)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontFamily: 'var(--font-mono)',
              color: i === 0 ? 'var(--teal)' : 'var(--text-muted)',
            }}>{n}</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{title}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 'auto', padding: 12, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>🔒 Privacy</div>
          <p style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            All scanning is local. No files are uploaded or transmitted.
          </p>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, padding: '28px 32px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Find duplicate files</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Choose how you want to scan, then configure your folders and rules.
          </p>
        </div>

        {/* ── Mode toggle ── */}
        <div>
          <Label>Scan mode</Label>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { id: 'compare', icon: '⚖', title: 'Compare locations', desc: 'Protected source vs. target to clean — recommended' },
              { id: 'simple',  icon: '🔍', title: 'Simple scan',       desc: 'Find all duplicates within a set of folders' },
            ].map(({ id, icon, title, desc }) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                style={{
                  flex: 1, padding: '14px 16px', textAlign: 'left',
                  borderRadius: 'var(--radius-md)',
                  border: `1.5px solid ${mode === id ? 'var(--teal)' : 'var(--border)'}`,
                  background: mode === id ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: mode === id ? 'var(--teal)' : 'var(--text-primary)', marginBottom: 3 }}>{title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Folder zones ── */}
        {mode === 'compare' ? (
          <div>
            <Label>Folder locations</Label>
            <div style={{
              display: 'flex', gap: 12,
              padding: 16,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <FolderZone
                label="Protected source"
                sublabel="— never deleted"
                accent="var(--teal)"
                folders={protectedFolders}
                onAdd={() => addToZone(setProtectedFolders)}
                onRemove={f => setProtectedFolders(prev => prev.filter(x => x !== f))}
              />
              <div style={{
                width: 1, background: 'var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute',
                  background: 'var(--bg-elevated)',
                  padding: '4px 6px',
                  fontSize: 10, color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                }}>vs</div>
              </div>
              <FolderZone
                label="Scan target"
                sublabel="— duplicates marked for deletion"
                accent="var(--red)"
                folders={targetFolders}
                onAdd={() => addToZone(setTargetFolders)}
                onRemove={f => setTargetFolders(prev => prev.filter(x => x !== f))}
              />
            </div>
            {protectedFolders.length > 0 && targetFolders.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>
                ⚠ Add at least one scan target folder to continue.
              </p>
            )}
          </div>
        ) : (
          <div>
            <Label>Folders to scan</Label>
            <FolderZone
              label="Scan folders"
              sublabel="— all duplicates found here"
              accent="var(--teal)"
              folders={simpleFolders}
              onAdd={() => addToZone(setSimpleFolders)}
              onRemove={f => setSimpleFolders(prev => prev.filter(x => x !== f))}
            />
          </div>
        )}

        {/* ── Auto-mark rule ── */}
        {mode === 'compare' && (
          <div>
            <Label>Auto-mark rule</Label>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              Controls which copy is auto-selected for deletion when duplicates are found.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {AUTO_MARK_RULES.map(({ id, label, desc }) => (
                <label key={id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 14px',
                  border: `1px solid ${autoMarkRule === id ? 'var(--teal)' : 'var(--border)'}`,
                  background: autoMarkRule === id ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}>
                  <input
                    type="radio"
                    name="autoMarkRule"
                    value={id}
                    checked={autoMarkRule === id}
                    onChange={() => setAutoMarkRule(id)}
                    style={{ marginTop: 2, accentColor: 'var(--teal)' }}
                  />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: autoMarkRule === id ? 'var(--teal)' : 'var(--text-primary)' }}>{label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── File type filter ── */}
        <div>
          <Label>File types</Label>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>Leave all off to scan every supported type.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {FILE_TYPES.map(({ id, label, icon }) => {
              const active = types.includes(id);
              return (
                <button key={id} onClick={() => toggleType(id)} style={{
                  padding: '7px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? 'var(--teal)' : 'var(--border)'}`,
                  background: active ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--teal)' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span>{icon}</span>{label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Size filter ── */}
        <div>
          <Label>Minimum file size</Label>
          <select
            value={minSize}
            onChange={e => setMinSize(Number(e.target.value))}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              padding: '7px 12px',
              fontSize: 12, width: 180,
            }}
          >
            {SIZE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* ── Start button ── */}
        <div style={{ paddingTop: 4, paddingBottom: 16 }}>
          <button
            onClick={handleStartScan}
            disabled={!canScan}
            style={{
              ...btnPrimary,
              fontSize: 14, padding: '12px 32px',
              opacity: canScan ? 1 : 0.4,
              cursor: canScan ? 'pointer' : 'not-allowed',
            }}
          >
            Start Scan →
          </button>
          {!canScan && (
            <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              {mode === 'compare'
                ? 'Add at least one protected source and one target folder.'
                : 'Add at least one folder to scan.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: 8, textTransform: 'uppercase' }}>{children}</p>;
}

const btnPrimary = { background: 'var(--teal)', color: '#0d0f14', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const btnSecondary = { background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 14px', fontSize: 11, cursor: 'pointer' };
const btnGhost = { background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' };
