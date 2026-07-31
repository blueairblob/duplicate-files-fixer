import React, { useState } from 'react';
import FolderBrowserModal from '../components/FolderBrowserModal.jsx';
import ScanOptionsSheet from '../components/ScanOptionsSheet.jsx';
import { useDPR } from '../contexts/DPRContext.jsx';
import {
  FolderIcon, ShieldIcon, TargetIcon, XIcon, PlusIcon,
  SlidersIcon, ChevronRightIcon, LockIcon, SearchIcon,
} from '../components/icons.jsx';

const api = window.electronAPI;

const SIZE_LABELS = { 0: 'any size', 102400: '> 100 KB', 1048576: '> 1 MB', 10485760: '> 10 MB', 104857600: '> 100 MB' };
const RULE_LABELS = {
  'protected-wins': 'protected wins',
  'keep-newest': 'keep newest',
  'keep-oldest': 'keep oldest',
  'keep-largest': 'keep largest',
};

// ── Folder zone ──────────────────────────────────────────────────────────────
function FolderZone({ label, sublabel, Icon, iconColor, folders, onAddPath, onRemove }) {
  const { scale } = useDPR();
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files)
      .filter(f => f.type === '')
      .map(f => f.path).filter(Boolean);
    if (dropped.length) dropped.forEach(p => onAddPath(p));
  };

  const openPicker = async (seedPath) => {
    if (!api) return;
    const paths = await api.openFolder(seedPath || undefined);
    if (paths && paths.length > 0) paths.forEach(p => onAddPath(p));
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        flex: 1, minWidth: 0,
        border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-md)',
        background: dragging ? 'var(--accent-tint)' : 'var(--bg-card)',
        padding: scale(18), textAlign: 'center',
        transition: 'border-color 0.12s ease, background 0.12s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: scale(6), marginBottom: scale(2) }}>
        <Icon size={scale(16)} color={iconColor} />
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 500 }}>{label}</span>
      </div>
      <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: scale(14) }}>{sublabel}</p>

      {folders.length === 0 ? (
        <p style={{ fontSize: 'var(--fs-secondary)', color: 'var(--text-muted)', margin: `${scale(6)}px 0 ${scale(14)}px` }}>
          Drop a folder here
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: scale(6), marginBottom: scale(12), textAlign: 'left' }}>
          {folders.map(f => (
            <div key={f} style={{
              display: 'flex', alignItems: 'center', gap: scale(8),
              background: 'var(--bg-inset)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: `${scale(7)}px ${scale(11)}px`,
            }}>
              <FolderIcon size={scale(15)} color="var(--text-secondary)" />
              <span title={f} style={{
                fontSize: 'var(--fs-secondary)', color: 'var(--text-primary)',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                direction: 'rtl', textAlign: 'left', /* ellipsize the start, keep the leaf folder visible */
              }}>{f}</span>
              <button onClick={() => onRemove(f)} style={{ background: 'transparent', color: 'var(--text-muted)', display: 'flex' }}>
                <XIcon size={scale(13)} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: scale(8) }}>
        <button onClick={() => openPicker(null)} style={{
          display: 'inline-flex', alignItems: 'center', gap: scale(5),
          background: 'transparent', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
          padding: `${scale(6)}px ${scale(13)}px`, fontSize: 'var(--fs-secondary)',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <PlusIcon size={scale(13)} /> Add folder…
        </button>
        <button onClick={() => setLocationsOpen(true)} style={{
          background: 'transparent', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)',
          display: 'inline-flex', alignItems: 'center', gap: scale(2),
        }}>
          Locations <ChevronRightIcon size={scale(12)} />
        </button>
      </div>

      {locationsOpen && (
        <FolderBrowserModal
          title={`Add to ${label}`}
          accent="var(--accent)"
          onConfirm={(p) => { onAddPath(p); setLocationsOpen(false); }}
          onClose={() => setLocationsOpen(false)}
        />
      )}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function HomeView({ onStartScan, exclusionCount = 0 }) {
  const { scale } = useDPR();
  const [mode, setMode] = useState('compare');
  const [protectedFolders, setProtectedFolders] = useState([]);
  const [targetFolders, setTargetFolders] = useState([]);
  const [simpleFolders, setSimpleFolders] = useState([]);
  const [types, setTypes] = useState([]);
  const [minSize, setMinSize] = useState(0);
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [autoMarkRule, setAutoMarkRule] = useState('protected-wins');
  const [optionsOpen, setOptionsOpen] = useState(false);

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

  // One-line summary of the collapsed options, so state stays visible
  const optionsSummary = [
    types.length === 0 ? 'All file types' : `${types.length} file type${types.length > 1 ? 's' : ''}`,
    SIZE_LABELS[minSize] || 'any size',
    ...(mode === 'compare' ? [RULE_LABELS[autoMarkRule]] : []),
    ...(includeEmpty ? ['incl. empty files'] : []),
    ...(exclusionCount > 0 ? [`${exclusionCount} exclusions`] : []),
  ].join(' · ');

  const modes = [
    { id: 'compare', label: 'Compare locations' },
    { id: 'simple',  label: 'Simple scan' },
    { id: 'verify',  label: 'Verify backup' },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: scale(680), margin: '0 auto', padding: `${scale(28)}px ${scale(32)}px ${scale(32)}px` }}>

        <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 500, marginBottom: scale(4) }}>
          Find duplicate files
        </h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', marginBottom: scale(24) }}>
          Choose where to look, then start the scan.
        </p>

        {/* Segmented mode control */}
        <div style={{
          display: 'inline-flex', background: 'var(--bg-inset)',
          borderRadius: 'var(--radius-sm)', padding: scale(3), marginBottom: scale(24),
        }}>
          {modes.map(({ id, label }) => {
            const active = mode === id;
            return (
              <button key={id} onClick={() => setMode(id)} title={
                id === 'compare' ? 'Protected source vs. target — recommended'
                : id === 'simple' ? 'Find all duplicates within a folder set'
                : 'Check every source file is present in the backup'
              } style={{
                padding: `${scale(6)}px ${scale(16)}px`,
                fontSize: 'var(--fs-secondary)', fontWeight: active ? 500 : 400,
                background: active ? 'var(--bg-card)' : 'transparent',
                border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
                borderRadius: scale(6),
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: active ? 'var(--shadow-card)' : 'none',
              }}>{label}</button>
            );
          })}
        </div>

        {/* Folder zones — the hero of the screen */}
        {mode === 'simple' ? (
          <div style={{ marginBottom: scale(20) }}>
            <FolderZone
              label="Folders to scan" sublabel="All duplicates found here"
              Icon={SearchIcon} iconColor="var(--accent)"
              folders={simpleFolders}
              onAddPath={p => addPathToZone(setSimpleFolders, p)}
              onRemove={f => setSimpleFolders(prev => prev.filter(x => x !== f))}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: scale(16), marginBottom: scale(20) }}>
            <FolderZone
              label={mode === 'verify' ? 'Source' : 'Protected source'}
              sublabel={mode === 'verify' ? 'The original files' : 'Never deleted'}
              Icon={ShieldIcon} iconColor="var(--accent)"
              folders={protectedFolders}
              onAddPath={p => addPathToZone(setProtectedFolders, p)}
              onRemove={f => setProtectedFolders(prev => prev.filter(x => x !== f))}
            />
            <FolderZone
              label={mode === 'verify' ? 'Backup' : 'Scan target'}
              sublabel={mode === 'verify' ? 'Checked for completeness' : 'Duplicates marked here'}
              Icon={TargetIcon} iconColor={mode === 'verify' ? 'var(--accent)' : 'var(--danger)'}
              folders={targetFolders}
              onAddPath={p => addPathToZone(setTargetFolders, p)}
              onRemove={f => setTargetFolders(prev => prev.filter(x => x !== f))}
            />
          </div>
        )}

        {/* Collapsed scan options */}
        <button onClick={() => setOptionsOpen(true)} style={{
          display: 'flex', alignItems: 'center', gap: scale(10), width: '100%',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: `${scale(12)}px ${scale(16)}px`,
          marginBottom: scale(24), textAlign: 'left',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-strong)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <SlidersIcon size={scale(17)} color="var(--text-secondary)" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--fs-secondary)', fontWeight: 500, color: 'var(--text-primary)' }}>
              Scan options
            </span>
            <span style={{
              display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{optionsSummary}</span>
          </span>
          <ChevronRightIcon size={scale(15)} color="var(--text-muted)" />
        </button>

        {/* Start */}
        <div style={{ display: 'flex', alignItems: 'center', gap: scale(14), flexWrap: 'wrap' }}>
          <button onClick={handleStart} disabled={!canScan} style={{
            background: 'var(--accent)', color: 'var(--on-accent)',
            borderRadius: 'var(--radius-sm)', fontWeight: 500,
            fontSize: 'var(--fs-body)', padding: `${scale(9)}px ${scale(24)}px`,
            opacity: canScan ? 1 : 0.45, cursor: canScan ? 'pointer' : 'not-allowed',
          }}>
            Start scan
          </button>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: scale(5),
            fontSize: 'var(--fs-caption)', color: 'var(--text-muted)',
          }}>
            <LockIcon size={scale(13)} />
            All scanning is local — no files leave this device
          </span>
        </div>
        {!canScan && (
          <p style={{ marginTop: scale(8), fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
            {mode === 'simple' ? 'Add at least one folder to scan.' : 'Add a folder to each side to start.'}
          </p>
        )}

      </div>

      {optionsOpen && (
        <ScanOptionsSheet
          mode={mode}
          types={types} onToggleType={toggleType}
          minSize={minSize} onMinSize={setMinSize}
          includeEmpty={includeEmpty} onIncludeEmpty={setIncludeEmpty}
          autoMarkRule={autoMarkRule} onAutoMarkRule={setAutoMarkRule}
          onReset={() => { setTypes([]); setMinSize(0); setIncludeEmpty(false); setAutoMarkRule('protected-wins'); }}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </div>
  );
}
