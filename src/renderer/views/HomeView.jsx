import React, { useState, useCallback } from 'react';
import LocationPicker from '../components/LocationPicker.jsx';
import ExclusionListPanel from '../components/ExclusionListPanel.jsx';

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

// ── Folder zone with integrated location picker ───────────────────────────────
function FolderZone({ label, sublabel, accent, folders, onAdd, onAddPath, onRemove }) {
  const [showPicker, setShowPicker] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files)
      .filter(f => f.type === '')
      .map(f => f.path).filter(Boolean);
    if (dropped.length) dropped.forEach(p => onAddPath(p));
  };

  const handlePickLocation = (p) => {
    onAddPath(p);
    setShowPicker(false);
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <div style={{ width:8, height:8, borderRadius:'50%', background:accent, flexShrink:0 }}/>
        <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{sublabel}</span>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border:`2px dashed ${dragging ? accent : 'var(--border-light)'}`,
          borderRadius:'var(--radius-md)', padding: folders.length === 0 ? 18 : 10,
          background: dragging ? `${accent}10` : folders.length > 0 ? 'var(--bg-elevated)' : 'transparent',
          transition:'all 0.15s ease', minHeight: 90,
        }}
      >
        {folders.length === 0 ? (
          <div style={{ textAlign:'center' }}>
            <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10 }}>Drop folder here, or</p>
            <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
              <button onClick={onAdd} style={{ ...btnSm, borderColor:accent, color:accent }}>📂 Browse</button>
              <button onClick={() => setShowPicker(v => !v)} style={{ ...btnSm, borderColor:accent, color:accent }}>🌐 Locations</button>
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {folders.map(f => (
              <div key={f} style={{
                display:'flex', alignItems:'center', gap:8, padding:'5px 10px',
                background:'var(--bg-surface)', border:'1px solid var(--border)',
                borderRadius:'var(--radius-sm)',
              }}>
                <span style={{ fontSize:12 }}>📂</span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-secondary)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f}</span>
                <button onClick={() => onRemove(f)} style={{ ...btnGhost, fontSize:10, color:'var(--red)', flexShrink:0 }}>✕</button>
              </div>
            ))}
            <div style={{ display:'flex', gap:8, marginTop:4 }}>
              <button onClick={onAdd} style={{ ...btnGhost, fontSize:11, color:accent }}>+ Browse</button>
              <button onClick={() => setShowPicker(v => !v)} style={{ ...btnGhost, fontSize:11, color:accent }}>🌐 Locations</button>
            </div>
          </div>
        )}
      </div>

      {showPicker && (
        <div style={{ marginTop:8 }}>
          <LocationPicker onSelect={handlePickLocation} />
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function HomeView({ onStartScan }) {
  const [mode, setMode] = useState('compare');
  const [protectedFolders, setProtectedFolders] = useState([]);
  const [targetFolders, setTargetFolders]       = useState([]);
  const [simpleFolders, setSimpleFolders]       = useState([]);
  const [types, setTypes]           = useState([]);
  const [minSize, setMinSize]       = useState(0);
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [autoMarkRule, setAutoMarkRule] = useState('protected-wins');

  const pickFolders = useCallback(async () => {
    if (!api) return [];
    return await api.openFolder();
  }, []);

  const addToZone = async (setter) => {
    const paths = await pickFolders();
    if (paths.length) setter(prev => [...new Set([...prev, ...paths])]);
  };

  const addPathToZone = (setter, p) => setter(prev => [...new Set([...prev, p])]);

  const toggleType = (id) =>
    setTypes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const canScan = mode === 'compare'
    ? protectedFolders.length > 0 && targetFolders.length > 0
    : simpleFolders.length > 0;

  const handleStart = () => {
    if (!canScan) return;
    onStartScan({
      mode,
      protectedFolders: mode === 'compare' ? protectedFolders : [],
      targetFolders:    mode === 'compare' ? targetFolders : simpleFolders,
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
        borderRight:'1px solid var(--border)', padding:'24px 18px',
        display:'flex', flexDirection:'column', gap:4,
      }}>
        <p style={{ fontSize:10, color:'var(--text-muted)', letterSpacing:'0.08em', marginBottom:16 }}>HOW IT WORKS</p>
        {[
          { n:'01', title:'Choose mode',   desc:'Simple or compare two locations' },
          { n:'02', title:'Add folders',   desc:'Protected source + target' },
          { n:'03', title:'Set rules',     desc:'Control what gets auto-marked' },
          { n:'04', title:'Scan & review', desc:'Delete with confidence' },
        ].map(({ n, title, desc }, i) => (
          <div key={n} style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:14 }}>
            <div style={{
              width:22, height:22, borderRadius:'50%', flexShrink:0,
              background: i === 0 ? 'var(--teal-dim)' : 'transparent',
              border:`1.5px solid ${i === 0 ? 'var(--teal)' : 'var(--border-light)'}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:9, fontFamily:'var(--font-mono)',
              color: i === 0 ? 'var(--teal)' : 'var(--text-muted)',
            }}>{n}</div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{title}</div>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2, lineHeight:1.4 }}>{desc}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop:'auto', padding:12, background:'var(--bg-elevated)', borderRadius:'var(--radius-md)', border:'1px solid var(--border)' }}>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:4 }}>🔒 Privacy</div>
          <p style={{ fontSize:10, color:'var(--text-secondary)', lineHeight:1.5 }}>All scanning is local. No files are uploaded.</p>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex:1, padding:'24px 28px', overflowY:'auto', display:'flex', flexDirection:'column', gap:22 }}>

        <div>
          <h1 style={{ fontSize:21, fontWeight:700, marginBottom:4 }}>Find duplicate files</h1>
          <p style={{ color:'var(--text-secondary)', fontSize:13 }}>Choose a scan mode, add folders, and configure your rules.</p>
        </div>

        {/* Mode toggle */}
        <div>
          <Label>Scan mode</Label>
          <div style={{ display:'flex', gap:10 }}>
            {[
              { id:'compare', icon:'⚖', title:'Compare locations', desc:'Protected source vs. target — recommended' },
              { id:'simple',  icon:'🔍', title:'Simple scan',       desc:'Find all dupes within a folder set' },
            ].map(({ id, icon, title, desc }) => (
              <button key={id} onClick={() => setMode(id)} style={{
                flex:1, padding:'12px 14px', textAlign:'left',
                borderRadius:'var(--radius-md)',
                border:`1.5px solid ${mode === id ? 'var(--teal)' : 'var(--border)'}`,
                background: mode === id ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                cursor:'pointer',
              }}>
                <div style={{ fontSize:15, marginBottom:4 }}>{icon}</div>
                <div style={{ fontSize:12, fontWeight:600, color: mode === id ? 'var(--teal)' : 'var(--text-primary)', marginBottom:3 }}>{title}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.4 }}>{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Folder zones */}
        {mode === 'compare' ? (
          <div>
            <Label>Folder locations</Label>
            <div style={{
              display:'flex', gap:12, padding:14,
              background:'var(--bg-elevated)', border:'1px solid var(--border)',
              borderRadius:'var(--radius-md)',
            }}>
              <FolderZone
                label="Protected source" sublabel="— never deleted" accent="var(--teal)"
                folders={protectedFolders}
                onAdd={() => addToZone(setProtectedFolders)}
                onAddPath={p => addPathToZone(setProtectedFolders, p)}
                onRemove={f => setProtectedFolders(prev => prev.filter(x => x !== f))}
              />
              <div style={{ width:1, background:'var(--border)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
                <div style={{ position:'absolute', background:'var(--bg-elevated)', padding:'4px 6px', fontSize:10, color:'var(--text-muted)', border:'1px solid var(--border)', borderRadius:4 }}>vs</div>
              </div>
              <FolderZone
                label="Scan target" sublabel="— dupes marked for deletion" accent="var(--red)"
                folders={targetFolders}
                onAdd={() => addToZone(setTargetFolders)}
                onAddPath={p => addPathToZone(setTargetFolders, p)}
                onRemove={f => setTargetFolders(prev => prev.filter(x => x !== f))}
              />
            </div>
          </div>
        ) : (
          <div>
            <Label>Folders to scan</Label>
            <FolderZone
              label="Scan folders" sublabel="— all dupes found here" accent="var(--teal)"
              folders={simpleFolders}
              onAdd={() => addToZone(setSimpleFolders)}
              onAddPath={p => addPathToZone(setSimpleFolders, p)}
              onRemove={f => setSimpleFolders(prev => prev.filter(x => x !== f))}
            />
          </div>
        )}

        {/* Auto-mark rule */}
        {mode === 'compare' && (
          <div>
            <Label>Auto-mark rule</Label>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {AUTO_MARK_RULES.map(({ id, label, desc }) => (
                <label key={id} style={{
                  display:'flex', alignItems:'flex-start', gap:10, padding:'9px 12px',
                  border:`1px solid ${autoMarkRule === id ? 'var(--teal)' : 'var(--border)'}`,
                  background: autoMarkRule === id ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                  borderRadius:'var(--radius-sm)', cursor:'pointer',
                }}>
                  <input type="radio" name="rule" value={id} checked={autoMarkRule === id}
                    onChange={() => setAutoMarkRule(id)} style={{ marginTop:2, accentColor:'var(--teal)' }}/>
                  <div>
                    <div style={{ fontSize:12, fontWeight:500, color: autoMarkRule === id ? 'var(--teal)' : 'var(--text-primary)' }}>{label}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* File types */}
        <div>
          <Label>File types</Label>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {FILE_TYPES.map(({ id, label, icon }) => {
              const active = types.includes(id);
              return (
                <button key={id} onClick={() => toggleType(id)} style={{
                  padding:'6px 12px', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500,
                  border:`1px solid ${active ? 'var(--teal)' : 'var(--border)'}`,
                  background: active ? 'var(--teal-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--teal)' : 'var(--text-secondary)',
                  display:'flex', alignItems:'center', gap:6, cursor:'pointer',
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
            padding:'7px 12px', fontSize:12, width:180,
          }}>
            {SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Zero-byte files */}
        <div>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', width:'fit-content' }}>
            <input
              type="checkbox"
              checked={includeEmpty}
              onChange={e => setIncludeEmpty(e.target.checked)}
              style={{ accentColor: 'var(--teal)' }}
            />
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>Include empty (zero-byte) files</span>
          </label>
          <p style={{ fontSize:10, color:'var(--text-muted)', marginTop:4, marginLeft:22 }}>
            Grouped separately by name — never mixed with content-based duplicates.
          </p>
        </div>

        {/* Exclusion list */}
        <div>
          <Label>Scan exclusions</Label>
          <ExclusionListPanel />
        </div>

        {/* Start */}
        <div style={{ paddingBottom:20 }}>
          <button onClick={handleStart} disabled={!canScan} style={{
            ...btnPrimary, fontSize:14, padding:'11px 30px',
            opacity: canScan ? 1 : 0.4, cursor: canScan ? 'pointer' : 'not-allowed',
          }}>
            Start Scan →
          </button>
          {!canScan && (
            <p style={{ marginTop:8, fontSize:11, color:'var(--text-muted)' }}>
              {mode === 'compare' ? 'Add at least one protected source and one target.' : 'Add at least one folder.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <p style={{ fontSize:10, fontWeight:600, color:'var(--text-secondary)', letterSpacing:'0.06em', marginBottom:8, textTransform:'uppercase' }}>{children}</p>;
}

const btnPrimary = { background:'var(--teal)', color:'#0d0f14', border:'none', borderRadius:'var(--radius-sm)', padding:'8px 18px', fontSize:12, fontWeight:600, cursor:'pointer' };
const btnSm      = { background:'transparent', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)', padding:'5px 12px', fontSize:11, cursor:'pointer' };
const btnGhost   = { background:'transparent', border:'none', borderRadius:'var(--radius-sm)', cursor:'pointer', fontSize:12, color:'var(--text-muted)' };
