import React, { useState, useCallback } from 'react';
import FolderBrowserModal from '../components/FolderBrowserModal.jsx';
import ExclusionListPanel from '../components/ExclusionListPanel.jsx';
import { useDPR } from '../contexts/DPRContext.jsx';

const api = window.electronAPI;

const FILE_TYPES = [
  { id: 'photos',   label: 'Photos',    icon: '🖼' },
  { id: 'audio',    label: 'Audio',     icon: '🎵' },
  { id: 'video',    label: 'Video',     icon: '🎬' },
  { id: 'docs',     label: 'Documents', icon: '📄' },
  { id: 'archives', label: 'Archives',  icon: '📦' },
];

const SIZE_OPTIONS = [
  { label: 'Any size',  value: 0 },
  { label: '> 100 KB', value: 102400 },
  { label: '> 1 MB',   value: 1048576 },
  { label: '> 10 MB',  value: 10485760 },
  { label: '> 100 MB', value: 104857600 },
];

const AUTO_MARK_RULES = [
  { id: 'protected-wins', label: 'Protected source wins', desc: 'Target copies that duplicate a protected file are always marked' },
  { id: 'keep-newest',    label: 'Keep newest',           desc: 'Among unprotected dupes, keep most recently modified' },
  { id: 'keep-oldest',    label: 'Keep oldest',           desc: 'Among unprotected dupes, keep earliest modified' },
  { id: 'keep-largest',   label: 'Keep largest',          desc: 'Keep the highest-size copy (useful for media)' },
];

// ── Folder zone ───────────────────────────────────────────────────────────────
// "Browse" opens the native OS folder picker directly (Windows Explorer on
// Windows, Finder on macOS, GTK portal on Linux). The "locations" link opens
// a compact quick-jump panel so users can seed the picker to a specific drive
// or common folder without hunting for it manually.
function FolderZone({ label, sublabel, accent, folders, onAddPath, onRemove }) {
  const { scale } = useDPR();
  const { btnSm, btnGhost } = makeStyles(scale);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [dragging, setDragging]           = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files)
      .filter(f => f.type === '')
      .map(f => f.path).filter(Boolean);
    if (dropped.length) dropped.forEach(p => onAddPath(p));
  };

  // Open the native picker, optionally pre-seeded to a path from the locations panel
  const openPicker = async (seedPath) => {
    if (!api) return;
    const paths = await api.openFolder(seedPath || undefined);
    if (paths && paths.length > 0) paths.forEach(p => onAddPath(p));
  };

  // Called by the LocationsPanel when the user picks a quick-jump location
  const handleLocationConfirm = (selectedPath) => {
    onAddPath(selectedPath);
    setLocationsOpen(false);
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display:'flex', alignItems:'center', gap: scale(8), marginBottom: scale(8) }}>
        <div style={{ width: scale(8), height: scale(8), borderRadius:'50%', background:accent, flexShrink:0 }}/>
        <span style={{ fontSize: scale(12), fontWeight:600, color:'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: scale(11), color:'var(--text-muted)' }}>{sublabel}</span>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border:`2px dashed ${dragging ? accent : 'var(--border-light)'}`,
          borderRadius:'var(--radius-md)', padding: scale(folders.length === 0 ? 18 : 10),
          background: dragging ? `${accent}10` : folders.length > 0 ? 'var(--bg-elevated)' : 'transparent',
          transition:'all 0.15s ease', minHeight: 90,
        }}
      >
        {folders.length === 0 ? (
          <div style={{ textAlign:'center' }}>
            <p style={{ fontSize: scale(12), color:'var(--text-muted)', marginBottom: scale(10) }}>Drop folder here, or</p>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap: scale(8) }}>
              <button onClick={() => openPicker(null)} style={{ ...btnSm, borderColor:accent, color:accent }}>📂 Browse…</button>
              <button onClick={() => setLocationsOpen(true)} style={{ ...btnGhost, fontSize: scale(11), color:'var(--text-muted)' }}>Locations ›</button>
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap: scale(5) }}>
            {folders.map(f => (
              <div key={f} style={{
                display:'flex', alignItems:'center', gap: scale(8), padding: `${scale(5)}px ${scale(10)}px`,
                background:'var(--bg-surface)', border:'1px solid var(--border)',
                borderRadius:'var(--radius-sm)',
              }}>
                <span style={{ fontSize: scale(12) }}>📂</span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize: scale(10), color:'var(--text-secondary)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f}</span>
                <button onClick={() => onRemove(f)} style={{ ...btnGhost, fontSize: scale(10), color:'var(--red)', flexShrink:0 }}>✕</button>
              </div>
            ))}
            <div style={{ display:'flex', alignItems:'center', gap: scale(8), marginTop: scale(4) }}>
              <button onClick={() => openPicker(null)} style={{ ...btnGhost, fontSize: scale(11), color:accent }}>+ Browse…</button>
              <button onClick={() => setLocationsOpen(true)} style={{ ...btnGhost, fontSize: scale(11), color:'var(--text-muted)' }}>Locations ›</button>
            </div>
          </div>
        )}
      </div>

      {locationsOpen && (
        <FolderBrowserModal
          title={`Add to ${label}`}
          accent={accent}
          onConfirm={handleLocationConfirm}
          onClose={() => setLocationsOpen(false)}
        />
      )}
    </div>
  );
}


// ── Main view ─────────────────────────────────────────────────────────────────
export default function HomeView({ onStartScan }) {
  const { scale } = useDPR();
  const { btnPrimary } = makeStyles(scale);
  const [mode, setMode] = useState('compare');
  const [protectedFolders, setProtectedFolders] = useState([]);
  const [targetFolders, setTargetFolders]       = useState([]);
  const [simpleFolders, setSimpleFolders]       = useState([]);
  const [types, setTypes]           = useState([]);
  const [minSize, setMinSize]       = useState(0);
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [autoMarkRule, setAutoMarkRule] = useState('protected-wins');

  const addPathToZone = (setter, p) => setter(prev => [...new Set([...prev, p])]);

  const toggleType = (id) =>
    setTypes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const canScan = mode === 'simple'
    ? simpleFolders.length > 0
    : protectedFolders.length > 0 && targetFolders.length > 0;

  const handleStart = () => {
    if (!canScan) return;
    onStartScan({
      mode,
      protectedFolders: mode === 'simple' ? [] : protectedFolders,
      targetFolders:    mode === 'simple' ? simpleFolders : targetFolders,
      filters: { types, minSize },
      autoMarkRule,
      includeEmpty,
    });
  };

  return (
    <div style={{ height:'100%', display:'flex', overflow:'hidden' }}>

      {/* Sidebar */}
      <div style={{
        width:200, flexShrink:0, background:'var(--bg-surface)',
        borderRight:'1px solid var(--border)', padding:`${scale(24)}px ${scale(18)}px`,
        display:'flex', flexDirection:'column', gap: scale(4),
      }}>
        <p style={{ fontSize: scale(10), color:'var(--text-muted)', letterSpacing:'0.08em', marginBottom: scale(16) }}>HOW IT WORKS</p>
        {[
          { n:'01', title:'Choose mode',   desc:'Simple or compare two locations' },
          { n:'02', title:'Add folders',   desc:'Protected source + target' },
          { n:'03', title:'Set rules',     desc:'Control what gets auto-marked' },
          { n:'04', title:'Scan & review', desc:'Delete with confidence' },
        ].map(({ n, title, desc }, i) => (
          <div key={n} style={{ display:'flex', gap: scale(10), alignItems:'flex-start', marginBottom: scale(14) }}>
            <div style={{
              width: scale(22), height: scale(22), borderRadius:'50%', flexShrink:0,
              background: i === 0 ? 'var(--teal-dim)' : 'transparent',
              border:`1.5px solid ${i === 0 ? 'var(--teal)' : 'var(--border-light)'}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize: scale(9), fontFamily:'var(--font-mono)',
              color: i === 0 ? 'var(--teal)' : 'var(--text-muted)',
            }}>{n}</div>
            <div>
              <div style={{ fontSize: scale(11), fontWeight:600, color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{title}</div>
              <div style={{ fontSize: scale(10), color:'var(--text-muted)', marginTop: scale(2), lineHeight:1.4 }}>{desc}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop:'auto', padding: scale(12), background:'var(--bg-elevated)', borderRadius:'var(--radius-md)', border:'1px solid var(--border)' }}>
          <div style={{ fontSize: scale(10), color:'var(--text-muted)', marginBottom: scale(4) }}>🔒 Privacy</div>
          <p style={{ fontSize: scale(10), color:'var(--text-secondary)', lineHeight:1.5 }}>All scanning is local. No files are uploaded.</p>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex:1, padding:`${scale(24)}px ${scale(28)}px`, overflowY:'auto', display:'flex', flexDirection:'column', gap: scale(22) }}>

        <div>
          <h1 style={{ fontSize: scale(21), fontWeight:700, marginBottom: scale(4) }}>Find duplicate files</h1>
          <p style={{ color:'var(--text-secondary)', fontSize:13 }}>Choose a scan mode, add folders, and configure your rules.</p>
        </div>

        {/* Mode toggle */}
        <div>
          <Label>Scan mode</Label>
          <div style={{ display:'flex', gap: scale(10) }}>
            {[
              { id:'compare', icon:'⚖', title:'Compare locations', desc:'Protected source vs. target — recommended' },
              { id:'simple',  icon:'🔍', title:'Simple scan',       desc:'Find all dupes within a folder set' },
              { id:'verify',  icon:'✅', title:'Verify backup',     desc:'Check every NAS file is present on desktop' },
            ].map(({ id, icon, title, desc }) => (
              <button key={id} onClick={() => setMode(id)} style={{
                flex:1, padding:`${scale(12)}px ${scale(14)}px`, textAlign:'left',
                borderRadius:'var(--radius-md)',
                border:`1.5px solid ${mode === id ? 'var(--teal)' : 'var(--border)'}`,
                background: mode === id ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                cursor:'pointer',
              }}>
                <div style={{ fontSize: scale(15), marginBottom: scale(4) }}>{icon}</div>
                <div style={{ fontSize: scale(12), fontWeight:600, color: mode === id ? 'var(--teal)' : 'var(--text-primary)', marginBottom: scale(3) }}>{title}</div>
                <div style={{ fontSize: scale(11), color:'var(--text-muted)', lineHeight:1.4 }}>{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Folder zones */}
        {mode === 'simple' ? (
          <div>
            <Label>Folders to scan</Label>
            <FolderZone
              label="Scan folders" sublabel="— all dupes found here" accent="var(--teal)"
              folders={simpleFolders}
              onAddPath={p => addPathToZone(setSimpleFolders, p)}
              onRemove={f => setSimpleFolders(prev => prev.filter(x => x !== f))}
            />
          </div>
        ) : (
          <div>
            <Label>Folder locations</Label>
            <div style={{
              display:'flex', gap: scale(12), padding: scale(14),
              background:'var(--bg-elevated)', border:'1px solid var(--border)',
              borderRadius:'var(--radius-md)',
            }}>
              <FolderZone
                label={mode === 'verify' ? 'NAS / source'   : 'Protected source'}
                sublabel={mode === 'verify' ? '— the original' : '— never deleted'}
                accent="var(--teal)"
                folders={protectedFolders}
                onAddPath={p => addPathToZone(setProtectedFolders, p)}
                onRemove={f => setProtectedFolders(prev => prev.filter(x => x !== f))}
              />
              <div style={{ width:1, background:'var(--border)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
                <div style={{ position:'absolute', background:'var(--bg-elevated)', padding:`${scale(4)}px ${scale(6)}px`, fontSize: scale(10), color:'var(--text-muted)', border:'1px solid var(--border)', borderRadius: 4 }}>
                  {mode === 'verify' ? '→' : 'vs'}
                </div>
              </div>
              <FolderZone
                label={mode === 'verify' ? 'Desktop / backup' : 'Scan target'}
                sublabel={mode === 'verify' ? '— check completeness' : '— dupes marked for deletion'}
                accent={mode === 'verify' ? 'var(--teal)' : 'var(--red)'}
                folders={targetFolders}
                onAddPath={p => addPathToZone(setTargetFolders, p)}
                onRemove={f => setTargetFolders(prev => prev.filter(x => x !== f))}
              />
            </div>
            {mode === 'verify' && (
              <p style={{ fontSize: scale(10), color:'var(--text-muted)', marginTop: scale(8) }}>
                ℹ Every file on the NAS will be checked against the desktop backup by content — renames and reorganised folders are handled correctly.
              </p>
            )}
          </div>
        )}

        {/* Auto-mark rule — not shown for verify mode */}
        {mode === 'compare' && (
          <div>
            <Label>Auto-mark rule</Label>
            <div style={{ display:'flex', flexDirection:'column', gap: scale(6) }}>
              {AUTO_MARK_RULES.map(({ id, label, desc }) => (
                <label key={id} style={{
                  display:'flex', alignItems:'flex-start', gap: scale(10), padding:`${scale(9)}px ${scale(12)}px`,
                  border:`1px solid ${autoMarkRule === id ? 'var(--teal)' : 'var(--border)'}`,
                  background: autoMarkRule === id ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                  borderRadius:'var(--radius-sm)', cursor:'pointer',
                }}>
                  <input type="radio" name="rule" value={id} checked={autoMarkRule === id}
                    onChange={() => setAutoMarkRule(id)} style={{ marginTop: scale(2), accentColor:'var(--teal)' }}/>
                  <div>
                    <div style={{ fontSize: scale(12), fontWeight:500, color: autoMarkRule === id ? 'var(--teal)' : 'var(--text-primary)' }}>{label}</div>
                    <div style={{ fontSize: scale(11), color:'var(--text-muted)', marginTop: scale(2) }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* File types */}
        <div>
          <Label>File types</Label>
          <div style={{ display:'flex', gap: scale(8), flexWrap:'wrap' }}>
            {FILE_TYPES.map(({ id, label, icon }) => {
              const active = types.includes(id);
              return (
                <button key={id} onClick={() => toggleType(id)} style={{
                  padding:`${scale(6)}px ${scale(12)}px`, borderRadius:'var(--radius-sm)', fontSize: scale(12), fontWeight:500,
                  border:`1px solid ${active ? 'var(--teal)' : 'var(--border)'}`,
                  background: active ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--teal)' : 'var(--text-secondary)',
                  display:'flex', alignItems:'center', gap: scale(6), cursor:'pointer',
                }}>
                  {icon} {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Min size */}
        <div>
          <Label>Minimum file size</Label>
          <select value={minSize} onChange={e => setMinSize(Number(e.target.value))} style={{
            background:'var(--bg-elevated)', border:'1px solid var(--border)',
            borderRadius:'var(--radius-sm)', color:'var(--text-primary)',
            padding:`${scale(7)}px ${scale(12)}px`, fontSize: scale(12), width:180,
          }}>
            {SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Zero-byte files */}
        <div>
          <label style={{ display:'flex', alignItems:'center', gap: scale(8), cursor:'pointer', width:'fit-content' }}>
            <input
              type="checkbox"
              checked={includeEmpty}
              onChange={e => setIncludeEmpty(e.target.checked)}
              style={{ accentColor: 'var(--teal)' }}
            />
            <span style={{ fontSize: scale(12), color:'var(--text-secondary)' }}>Include empty (zero-byte) files</span>
          </label>
          <p style={{ fontSize: scale(10), color:'var(--text-muted)', marginTop: scale(4), marginLeft: scale(22) }}>
            Grouped separately by name — never mixed with content-based duplicates.
          </p>
        </div>

        {/* Exclusion list */}
        <div>
          <Label>Scan exclusions</Label>
          <ExclusionListPanel />
        </div>

        {/* Start */}
        <div style={{ paddingBottom: scale(20) }}>
          <button onClick={handleStart} disabled={!canScan} style={{
            ...btnPrimary, fontSize: scale(14), padding:`${scale(11)}px ${scale(30)}px`,
            opacity: canScan ? 1 : 0.4, cursor: canScan ? 'pointer' : 'not-allowed',
          }}>
            Start Scan →
          </button>
          {!canScan && (
            <p style={{ marginTop: scale(8), fontSize: scale(11), color:'var(--text-muted)' }}>
              {mode === 'simple' ? 'Add at least one folder.' : 'Add a NAS source and a desktop backup folder.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  const { scale } = useDPR();
  return <p style={{ fontSize: scale(10), fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: scale(8), textTransform: 'uppercase' }}>{children}</p>;
}

// Shared button styles, derived from the current DPR scale. Both HomeView and
// the FolderZone child component call this with their own useDPR().scale.
function makeStyles(scale) {
  return {
    btnPrimary: { background: 'var(--teal)', color: '#0d0f14', border: 'none', borderRadius: 'var(--radius-sm)', padding: `${scale(8)}px ${scale(18)}px`, fontSize: scale(12), fontWeight: 600, cursor: 'pointer' },
    btnSm:      { background: 'transparent', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: `${scale(5)}px ${scale(12)}px`, fontSize: scale(11), cursor: 'pointer' },
    btnGhost:   { background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: scale(12), color: 'var(--text-muted)' },
  };
}
