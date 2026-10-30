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

// Five stages, in the order data travels (device → local → NAS → archive):
//   import  — a device (SD card, camera, USB) → a local Inbox: copy only what
//             the Inbox/backup don't already have; the device is never changed
//   move    — the local copy → the backup: copy only what the backup doesn't
//             already have (anywhere), verify every copy, then optionally free
//             up the local copies
//   compare — "Check backup": an Original against a Copy — what's missing,
//             what's in both, what's only in the copy
//   find    — "Clean up duplicates" within any set of folders; folders marked
//             Keep are compared against but never touched
//   archive — the backup → a long-term drive (mirrored, verified), plus an
//             integrity record that can be re-checked later
const JOBS = [
  { id: 'import',  short: 'Import',         label: 'Import from device',  hint: 'Copy new photos and files from an SD card, camera or USB drive into a local Inbox' },
  { id: 'move',    short: 'Move to backup', label: 'Move to backup',      hint: 'Copy what’s new from a local copy into your backup, then free up the space' },
  { id: 'compare', short: 'Check',          label: 'Check backup',        hint: 'Check an original against a copy or backup: what’s missing, matched, or extra' },
  { id: 'find',    short: 'Clean up',       label: 'Clean up duplicates', hint: 'Find and remove duplicate files in one or more folders' },
  { id: 'archive', short: 'Archive',        label: 'Archive backup',      hint: 'Make a verified long-term copy of your backup, with a record to re-check it for damage later' },
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
  if (job === 'import') {
    return b.code === 'same'
      ? `The device and the Inbox are the same folder (${b.protected}).`
      : `The device folder “${b.target}” is inside “${b.protected}”. Pick the device itself.`;
  }
  if (job === 'archive') {
    return b.code === 'same'
      ? `The backup and the archive are the same folder (${b.protected}).`
      : `The backup “${b.target}” is inside the archive folder “${b.protected}”. Pick an archive folder outside the backup.`;
  }
  if (job === 'move') {
    return b.code === 'same'
      ? `“From” and “To” are the same folder (${b.protected}).`
      : `“${b.target}” is already inside the backup folder “${b.protected}”. Pick the local copy, outside the backup.`;
  }
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
export default function HomeView({ onStartScan, onVerifyArchive, preset = null }) {
  const { scale } = useDPR();
  // Shown in the options summary; re-read each time Home is shown.
  const [exclusionCount, setExclusionCount] = useState(0);
  useEffect(() => {
    api?.getExclusions?.().then(list => setExclusionCount(Array.isArray(list) ? list.length : 0)).catch(() => {});
  }, []);

  const [job, setJob] = useState('import');
  const [moveFrom, setMoveFrom] = useState([]);
  const [moveTo, setMoveTo] = useState([]);   // exactly one backup folder
  const [importFrom, setImportFrom] = useState([]);     // the device (one)
  const [inbox, setInbox] = useState([]);               // local Inbox (one)
  const [importBackup, setImportBackup] = useState([]); // optional: also skip what's already backed up
  const [archiveFrom, setArchiveFrom] = useState([]);   // the backup
  const [archiveTo, setArchiveTo] = useState([]);       // the archive drive/folder (one)
  const [verifyRoot, setVerifyRoot] = useState([]);     // an archive to re-check
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    if (job !== 'import' || !api?.listDevices) return;
    api.listDevices().then(d => setDevices(Array.isArray(d) ? d : [])).catch(() => setDevices([]));
  }, [job]);
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
  // Move to backup always reads every byte: it skips and later removes files
  // only when they're proven identical to the backup copy.
  const confidence = job === 'move' || job === 'import' || job === 'archive' ? 'thorough' : job === 'compare' ? compareConfidence : findConfidence;
  const setConfidence = job === 'move' || job === 'import' || job === 'archive' ? () => {} : job === 'compare' ? setCompareConfidence : setFindConfidence;

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
    if (j === 'import') {
      setInbox((preset.protectedFolders || []).slice(0, 1));
      setImportBackup((preset.protectedFolders || []).slice(1, 2));
      setImportFrom((preset.targetFolders || []).slice(0, 1));
    } else if (j === 'archive') {
      setArchiveTo((preset.protectedFolders || []).slice(0, 1));
      setArchiveFrom(preset.targetFolders || []);
    } else if (j === 'move') {
      setMoveTo((preset.protectedFolders || []).slice(0, 1));
      setMoveFrom(preset.targetFolders || []);
    } else if (j === 'find') {
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
  const canScan = job === 'import' ? importFrom.length === 1 && inbox.length === 1
    : job === 'archive' ? archiveFrom.length > 0 && archiveTo.length === 1
    : job === 'move' ? moveFrom.length > 0 && moveTo.length === 1
    : job === 'find' ? cleanFolders.length > 0
    : originalFolders.length > 0 && copyFolders.length > 0;

  // Overlapping or aliased folders are checked before the scan starts (and
  // again in the main process). See src/main/roots.js for the rules.
  const [rootProblem, setRootProblem] = useState(null);
  useEffect(() => { setRootProblem(null); }, [job, findFolders, keep, originalFolders, copyFolders, moveFrom, moveTo, importFrom, inbox, importBackup, archiveFrom, archiveTo]);

  // Engine mapping: Find with Keep folders is a protected-vs-target scan;
  // without them it's a plain duplicate scan. Compare is always two-sided.
  const buildConfig = () => {
    const base = { job, filters: { types, minSize }, autoMarkRule, includeEmpty, confidence };
    if (job === 'move') return { ...base, mode: 'compare', protectedFolders: moveTo, targetFolders: moveFrom, confidence: 'thorough' };
    // Import copies into the Inbox (first protected folder); the backup, if
    // given, only adds "already have it" matches.
    if (job === 'import') return { ...base, mode: 'compare', protectedFolders: [...inbox, ...importBackup], targetFolders: importFrom, confidence: 'thorough' };
    if (job === 'archive') return { ...base, mode: 'compare', protectedFolders: archiveTo, targetFolders: archiveFrom, confidence: 'thorough' };
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
          {JOBS.find(j => j.id === job).label}
        </h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', marginBottom: scale(24) }}>
          {JOBS.find(j => j.id === job).hint}.
        </p>

        {/* Segmented job control */}
        <div role="group" aria-label="What do you want to do?" style={{
          display: 'inline-flex', background: 'var(--bg-inset)',
          borderRadius: 'var(--radius-sm)', padding: scale(3), marginBottom: scale(24),
        }}>
          {JOBS.map(({ id, short, label, hint }, i) => {
            const active = job === id;
            return (
              <button key={id} onClick={() => setJob(id)} aria-pressed={active} aria-label={label} title={hint} style={{
                padding: `${scale(6)}px ${scale(12)}px`,
                fontSize: 'var(--fs-secondary)', fontWeight: active ? 500 : 400,
                background: active ? 'var(--bg-card)' : 'transparent',
                border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
                borderRadius: scale(6),
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: active ? 'var(--shadow-card)' : 'none',
                whiteSpace: 'nowrap',
              }}><span aria-hidden style={{ color: 'var(--text-muted)', marginRight: scale(5) }}>{i + 1}</span>{short}</button>
            );
          })}
        </div>

        {/* Folder zones — the hero of the screen */}
        {job === 'import' ? (
          <div style={{ marginBottom: scale(20) }}>
            {devices.length > 0 && (
              <div style={{ display: 'flex', gap: scale(8), flexWrap: 'wrap', alignItems: 'center', marginBottom: scale(12), fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)' }}>
                Connected:
                {devices.map(d => (
                  <button key={d.path} onClick={() => setImportFrom([d.dcim || d.path])} style={{
                    padding: `${scale(4)}px ${scale(10)}px`, borderRadius: scale(12), border: '1px solid var(--border-strong)',
                    background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 'var(--fs-caption)',
                  }}>{d.label}{d.dcim ? ' · photos' : ''}</button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: scale(16) }}>
              <FolderZone
                label="Device"
                sublabel="An SD card, camera or USB drive (pick its DCIM folder for photos). Nothing on the device is ever changed. Phones: coming next — for now, use the phone's own import into the Inbox."
                Icon={FolderIcon} iconColor="var(--text-secondary)"
                folders={importFrom}
                onAddPath={p => setImportFrom([p])}
                onRemove={() => setImportFrom([])}
              />
              <FolderZone
                label="Inbox"
                sublabel="A local folder where imports land, before Move to backup sends them on."
                Icon={FolderIcon} iconColor="var(--accent)"
                folders={inbox}
                onAddPath={p => setInbox([p])}
                onRemove={() => setInbox([])}
              />
            </div>
            <div style={{ marginTop: scale(12) }}>
              <FolderZone
                label="Your backup (optional)"
                sublabel="Also skip anything that's already in your backup, even if it has left the Inbox."
                Icon={ShieldIcon} iconColor="var(--accent)"
                folders={importBackup}
                onAddPath={p => setImportBackup([p])}
                onRemove={() => setImportBackup([])}
              />
            </div>
          </div>
        ) : job === 'archive' ? (
          <div style={{ marginBottom: scale(20) }}>
            <div style={{ display: 'flex', gap: scale(16) }}>
              <FolderZone
                label="Backup"
                sublabel="What to archive, e.g. your NAS photo folder. Never changed."
                Icon={ShieldIcon} iconColor="var(--accent)"
                folders={archiveFrom}
                onAddPath={p => addPathTo(setArchiveFrom, p)}
                onRemove={f => setArchiveFrom(prev => prev.filter(x => x !== f))}
              />
              <FolderZone
                label="Archive"
                sublabel="A long-term drive or folder, e.g. an external disk you keep offline. Gets a mirrored, verified copy plus an integrity record."
                Icon={TargetIcon} iconColor="var(--text-secondary)"
                folders={archiveTo}
                onAddPath={p => setArchiveTo([p])}
                onRemove={() => setArchiveTo([])}
              />
            </div>
            <div style={{
              marginTop: scale(12), padding: `${scale(12)}px ${scale(14)}px`, borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: scale(12), flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: scale(220) }}>
                <div style={{ fontSize: 'var(--fs-secondary)', fontWeight: 500 }}>Re-check an archive</div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)' }}>
                  {verifyRoot[0] ? verifyRoot[0] : 'Re-read every file and compare it with its integrity record — catches silent damage, edits and losses.'}
                </div>
              </div>
              <button onClick={async () => { const p = api ? await api.openFolder() : []; if (p && p[0]) setVerifyRoot([p[0]]); }}
                style={{ padding: `${scale(6)}px ${scale(12)}px`, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-primary)', fontSize: 'var(--fs-secondary)' }}>
                Choose archive…
              </button>
              <button disabled={!verifyRoot[0]} onClick={() => onVerifyArchive && onVerifyArchive(verifyRoot[0])}
                style={{ padding: `${scale(6)}px ${scale(12)}px`, borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-secondary)', opacity: verifyRoot[0] ? 1 : 0.45 }}>
                Re-check
              </button>
            </div>
          </div>
        ) : job === 'move' ? (
          <div style={{ display: 'flex', gap: scale(16), marginBottom: scale(20) }}>
            <FolderZone
              label="From"
              sublabel="A local copy from a phone, camera or other device. Nothing here is removed unless you choose to, after it's verified in the backup."
              Icon={FolderIcon} iconColor="var(--text-secondary)"
              folders={moveFrom}
              onAddPath={p => addPathTo(setMoveFrom, p)}
              onRemove={f => setMoveFrom(prev => prev.filter(x => x !== f))}
            />
            <FolderZone
              label="To (your backup)"
              sublabel="Your backup folder, e.g. on a NAS. The whole folder is checked, so files already there under any name aren't copied twice."
              Icon={ShieldIcon} iconColor="var(--accent)"
              folders={moveTo}
              onAddPath={p => setMoveTo([p])}
              onRemove={() => setMoveTo([])}
            />
          </div>
        ) : job === 'find' ? (
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
            {{ import: 'See what’s new', move: 'See what’s new', compare: 'Compare', find: 'Find duplicates', archive: 'See what to archive' }[job]}
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
            {job === 'import'
              ? 'Pick the device and your Inbox folder.'
              : job === 'archive'
              ? 'Pick the backup and an archive folder.'
              : job === 'move'
              ? 'Add the local copy (From) and your backup folder (To).'
              : job === 'compare'
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
