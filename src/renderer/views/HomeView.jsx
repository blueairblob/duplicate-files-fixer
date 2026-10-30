import React, { useState, useEffect } from 'react';
import FolderBrowserModal from '../components/FolderBrowserModal.jsx';
import ScanOptionsSheet from '../components/ScanOptionsSheet.jsx';
import { useDPR } from '../contexts/DPRContext.jsx';
import {
  FolderIcon, ShieldIcon, TargetIcon, XIcon, PlusIcon,
  SlidersIcon, ChevronRightIcon, ChevronDownIcon, LockIcon, SearchIcon,
} from '../components/icons.jsx';
import { jobOf } from '../utils/scanHistory.js';

const api = window.electronAPI;

const SIZE_LABELS = { 0: 'any size', 102400: '> 100 KB', 1048576: '> 1 MB', 10485760: '> 10 MB', 104857600: '> 100 MB' };
const RULE_LABELS = {
  'keep-newest': 'keep newest',
  'keep-oldest': 'keep oldest',
  'keep-largest': 'keep largest',
};
const CONFIDENCE_LABELS = { quick: 'quick match', standard: 'standard match', thorough: 'thorough match' };

// The app does two jobs (like dupeGuru / Duplicate Cleaner for the first,
// FreeFileSync-style left/right comparison for the second):
//   find    — duplicates within any set of folders; folders marked Keep are
//             compared against but never touched
//   compare — an Original against a Copy (e.g. a backup): what's missing,
//             what's in both, what's only in the copy
const JOBS = [
  { id: 'find',    label: 'Find duplicates', hint: 'Find and remove duplicate files in one or more folders' },
  { id: 'compare', label: 'Compare folders', hint: 'Check an original against a copy or backup: what’s missing, matched, or extra' },
];

// ── Folder zone ──────────────────────────────────────────────────────────────
// `keep` (a Set) + `onToggleKeep` add a per-folder Keep switch.
function FolderZone({ label, sublabel, Icon, iconColor, folders, onAddPath, onRemove, keep, onToggleKeep }) {
  const { scale } = useDPR();
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    // Folders arrive with an empty MIME type. File.path no longer exists
    // (removed in Electron 32), so ask the preload bridge for the real path.
    const dropped = Array.from(e.dataTransfer.files)
      .filter(f => f.type === '')
      .map(f => { try { return api?.getPathForFile ? api.getPathForFile(f) : ''; } catch { return ''; } })
      .filter(Boolean);
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
          {folders.map(f => {
            const kept = !!keep && keep.has(f);
            return (
              <div key={f} style={{
                display: 'flex', alignItems: 'center', gap: scale(8),
                background: kept ? 'var(--accent-tint)' : 'var(--bg-inset)',
                border: `1px solid ${kept ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-sm)', padding: `${scale(7)}px ${scale(11)}px`,
              }}>
                {kept
                  ? <ShieldIcon size={scale(15)} color="var(--accent)" />
                  : <FolderIcon size={scale(15)} color="var(--text-secondary)" />}
                <span title={f} style={{
                  fontSize: 'var(--fs-secondary)', color: 'var(--text-primary)',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  direction: 'rtl', textAlign: 'left', /* ellipsize the start, keep the leaf folder visible */
                }}>{f}</span>
                {onToggleKeep && (
                  <button onClick={() => onToggleKeep(f)} aria-pressed={kept}
                    title={kept ? 'Kept: never changed — copies elsewhere can be removed' : 'Mark as Keep: this folder is never changed'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: scale(4), flexShrink: 0,
                      padding: `${scale(2)}px ${scale(8)}px`, borderRadius: scale(10),
                      border: `1px solid ${kept ? 'var(--accent)' : 'var(--border-strong)'}`,
                      background: kept ? 'var(--accent)' : 'transparent',
                      color: kept ? 'var(--on-accent, #fff)' : 'var(--text-secondary)',
                      fontSize: 'var(--fs-caption)',
                    }}>
                    <LockIcon size={scale(11)} /> Keep
                  </button>
                )}
                <button onClick={() => onRemove(f)} aria-label={`Remove ${f}`} title="Remove" style={{ background: 'transparent', color: 'var(--text-muted)', display: 'flex' }}>
                  <XIcon size={scale(13)} />
                </button>
              </div>
            );
          })}
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

// Why a scan can't start, in the words of the job (see roots.js codes).
function rootProblemText(job, b) {
  if (job === 'find') {
    return b.code === 'same'
      ? `“${b.target}” is listed twice — once as Keep and once to clean up.`
      : `“${b.target}” is inside the Keep folder “${b.protected}”, so nothing in it could be removed. Remove it, or un-Keep the outer folder.`;
  }
  return b.code === 'same'
    ? `Original and Copy are the same folder (${b.protected}).`
    : `The Copy “${b.target}” is inside the Original “${b.protected}”. Pick a Copy outside the Original.`;
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function HomeView({ onStartScan, preset = null }) {
  const { scale } = useDPR();
  // Shown in the options summary; re-read each time Home is shown.
  const [exclusionCount, setExclusionCount] = useState(0);
  useEffect(() => {
    api?.getExclusions?.().then(list => setExclusionCount(Array.isArray(list) ? list.length : 0)).catch(() => {});
  }, []);

  const [job, setJob] = useState('find');
  const [findFolders, setFindFolders] = useState([]);
  const [keep, setKeep] = useState(() => new Set());
  const [originalFolders, setOriginalFolders] = useState([]);
  const [copyFolders, setCopyFolders] = useState([]);

  // Scan options persist across sessions
  const savedOptions = (() => {
    try { return JSON.parse(localStorage.getItem('holdfast-scan-options')) || {}; } catch { return {}; }
  })();
  const [types, setTypes] = useState(savedOptions.types || []);
  const [minSize, setMinSize] = useState(savedOptions.minSize || 0);
  const [includeEmpty, setIncludeEmpty] = useState(!!savedOptions.includeEmpty);
  const [autoMarkRule, setAutoMarkRule] = useState(RULE_LABELS[savedOptions.autoMarkRule] ? savedOptions.autoMarkRule : 'keep-newest');
  // Each job keeps its own match confidence. Compare defaults to Thorough: a
  // "nothing is missing" verdict is only as strong as what was read. Find
  // defaults to Standard: every deletion is checked byte-for-byte anyway.
  const [findConfidence, setFindConfidence] = useState(savedOptions.confidence || 'standard');
  const [compareConfidence, setCompareConfidence] = useState(savedOptions.compareConfidence || savedOptions.verifyConfidence || 'thorough');
  const confidence = job === 'compare' ? compareConfidence : findConfidence;
  const setConfidence = job === 'compare' ? setCompareConfidence : setFindConfidence;

  useEffect(() => {
    try {
      localStorage.setItem('holdfast-scan-options', JSON.stringify({ types, minSize, includeEmpty, autoMarkRule, confidence: findConfidence, compareConfidence }));
    } catch { /* non-fatal */ }
  }, [types, minSize, includeEmpty, autoMarkRule, findConfidence, compareConfidence]);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Seed the form when a history/recents entry is loaded. Keyed so clicking
  // the same entry twice re-applies it.
  useEffect(() => {
    if (!preset) return;
    const j = jobOf(preset);
    setJob(j);
    if (preset.confidence) (j === 'compare' ? setCompareConfidence : setFindConfidence)(preset.confidence);
    if (j === 'find') {
      setFindFolders([...(preset.protectedFolders || []), ...(preset.targetFolders || [])]);
      setKeep(new Set(preset.protectedFolders || []));
    } else {
      setOriginalFolders(preset.protectedFolders || []);
      setCopyFolders(preset.targetFolders || []);
    }
  }, [preset && preset.key]);

  const addPathTo = (setter, p) => setter(prev => [...new Set([...prev, p])]);
  const toggleKeep = (p) => setKeep(prev => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });
  const removeFind = (p) => {
    setFindFolders(prev => prev.filter(x => x !== p));
    setKeep(prev => { const next = new Set(prev); next.delete(p); return next; });
  };
  const toggleType = (id) => setTypes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const keptFolders = findFolders.filter(f => keep.has(f));
  const cleanFolders = findFolders.filter(f => !keep.has(f));
  const canScan = job === 'find' ? cleanFolders.length > 0 : originalFolders.length > 0 && copyFolders.length > 0;

  // Overlapping or aliased folders are checked before the scan starts (and
  // again in the main process). See src/main/roots.js for the rules.
  const [rootProblem, setRootProblem] = useState(null);
  useEffect(() => { setRootProblem(null); }, [job, findFolders, keep, originalFolders, copyFolders]);

  // Engine mapping: Find with Keep folders is a protected-vs-target scan;
  // without them it's a plain duplicate scan. Compare is always two-sided.
  const buildConfig = () => {
    const base = { job, filters: { types, minSize }, autoMarkRule, includeEmpty, confidence };
    if (job === 'compare') return { ...base, mode: 'compare', protectedFolders: originalFolders, targetFolders: copyFolders };
    return keptFolders.length > 0
      ? { ...base, mode: 'compare', protectedFolders: keptFolders, targetFolders: cleanFolders }
      : { ...base, mode: 'simple', protectedFolders: [], targetFolders: cleanFolders };
  };

  const handleStart = async () => {
    if (!canScan) return;
    const config = buildConfig();
    if (api?.checkRoots && config.mode !== 'simple') {
      try {
        const check = await api.checkRoots(config);
        if (check?.blocked?.length) { setRootProblem(rootProblemText(job, check.blocked[0])); return; }
      } catch { /* the main process re-checks on scan start */ }
    }
    onStartScan(config);
  };

  // One-line summary of the collapsed options, so state stays visible
  const optionsSummary = [
    CONFIDENCE_LABELS[confidence] || 'standard match',
    types.length === 0 ? 'All file types' : `${types.length} file type${types.length > 1 ? 's' : ''}`,
    SIZE_LABELS[minSize] || 'any size',
    ...(job === 'find' ? [RULE_LABELS[autoMarkRule]] : []),
    ...(includeEmpty ? ['incl. empty files'] : []),
    ...(exclusionCount > 0 ? [`${exclusionCount} exclusions`] : []),
  ].join(' · ');

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: scale(680), margin: '0 auto', padding: `${scale(28)}px ${scale(32)}px ${scale(32)}px` }}>

        <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 500, marginBottom: scale(4) }}>
          {job === 'find' ? 'Find duplicates' : 'Compare folders'}
        </h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', marginBottom: scale(24) }}>
          {JOBS.find(j => j.id === job).hint}.
        </p>

        {/* Segmented job control */}
        <div role="group" aria-label="What do you want to do?" style={{
          display: 'inline-flex', background: 'var(--bg-inset)',
          borderRadius: 'var(--radius-sm)', padding: scale(3), marginBottom: scale(24),
        }}>
          {JOBS.map(({ id, label, hint }) => {
            const active = job === id;
            return (
              <button key={id} onClick={() => setJob(id)} aria-pressed={active} title={hint} style={{
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
        {job === 'find' ? (
          <div style={{ marginBottom: scale(20) }}>
            <FolderZone
              label="Folders to search"
              sublabel="Duplicates are found across all of these. Mark a folder Keep and it's never changed — its copies elsewhere are selected for removal instead."
              Icon={SearchIcon} iconColor="var(--accent)"
              folders={findFolders}
              keep={keep} onToggleKeep={toggleKeep}
              onAddPath={p => addPathTo(setFindFolders, p)}
              onRemove={removeFind}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: scale(16), marginBottom: scale(20) }}>
            <FolderZone
              label="Original"
              sublabel="Your files. Never changed."
              Icon={ShieldIcon} iconColor="var(--accent)"
              folders={originalFolders}
              onAddPath={p => addPathTo(setOriginalFolders, p)}
              onRemove={f => setOriginalFolders(prev => prev.filter(x => x !== f))}
            />
            <FolderZone
              label="Copy"
              sublabel="A backup or copy, checked against the Original."
              Icon={TargetIcon} iconColor="var(--text-secondary)"
              folders={copyFolders}
              onAddPath={p => addPathTo(setCopyFolders, p)}
              onRemove={f => setCopyFolders(prev => prev.filter(x => x !== f))}
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
          <ChevronDownIcon size={scale(15)} color="var(--text-muted)" />
        </button>

        {/* Start */}
        <div style={{ display: 'flex', alignItems: 'center', gap: scale(14), flexWrap: 'wrap' }}>
          <button onClick={handleStart} disabled={!canScan} style={{
            background: 'var(--accent)', color: 'var(--on-accent)',
            borderRadius: 'var(--radius-sm)', fontWeight: 500,
            fontSize: 'var(--fs-body)', padding: `${scale(9)}px ${scale(24)}px`,
            opacity: canScan ? 1 : 0.45, cursor: canScan ? 'pointer' : 'not-allowed',
          }}>
            {job === 'find' ? 'Find duplicates' : 'Compare'}
          </button>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: scale(5),
            fontSize: 'var(--fs-caption)', color: 'var(--text-muted)',
          }}>
            <LockIcon size={scale(13)} />
            All scanning is local — no files leave this device
          </span>
        </div>

        {rootProblem && (
          <p role="alert" style={{ marginTop: scale(10), fontSize: 'var(--fs-secondary)', color: 'var(--danger)', lineHeight: 1.5 }}>
            Can't start: {rootProblem}
          </p>
        )}
        {!canScan && (
          <p style={{ marginTop: scale(8), fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
            {job === 'compare'
              ? 'Add an Original and a Copy to compare.'
              : findFolders.length > 0
                ? 'Every folder is marked Keep. Add a folder to clean up, or un-Keep one.'
                : 'Add at least one folder to search.'}
          </p>
        )}
      </div>

      {optionsOpen && (
        <ScanOptionsSheet
          mode={job}
          types={types} onToggleType={toggleType}
          minSize={minSize} onMinSize={setMinSize}
          includeEmpty={includeEmpty} onIncludeEmpty={setIncludeEmpty}
          autoMarkRule={autoMarkRule} onAutoMarkRule={setAutoMarkRule}
          confidence={confidence} onConfidence={setConfidence}
          onReset={() => { setTypes([]); setMinSize(0); setIncludeEmpty(false); setAutoMarkRule('keep-newest'); setFindConfidence('standard'); setCompareConfidence('thorough'); }}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </div>
  );
}
