import React, { useEffect, useRef, useState } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { ShieldIcon, TargetIcon, SearchIcon, FolderIcon } from '../components/icons.jsx';

const api = window.electronAPI;

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function ScanView({ scanConfig, onComplete, onCancel }) {
  const { scale } = useDPR();
  const { mode, protectedFolders = [], targetFolders = [], filters = {}, autoMarkRule, includeEmpty } = scanConfig || {};

  const [scanned,     setScanned]     = useState(0);
  // phase: 'walking' | 'hashing' | 'verifying'
  const [phase,       setPhase]       = useState('walking');
  const [total,       setTotal]       = useState(0);
  const [currentPath, setCurrentPath] = useState('');
  const [cancelling,  setCancelling]  = useState(false);
  const cancelled = useRef(false);

  // ── Throughput instrumentation ──────────────────────────────────────────────
  // Rolling window of (time, scanned) samples so speed reflects the last ~6s
  // rather than the whole run; ETA derives from that live rate.
  const [now, setNow] = useState(() => Date.now());
  const startRef   = useRef(Date.now());
  const samplesRef = useRef([]);
  const scannedRef = useRef(0);
  scannedRef.current = scanned;

  useEffect(() => {
    startRef.current = Date.now();
    const tick = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const samples = samplesRef.current;
      samples.push([t, scannedRef.current]);
      while (samples.length > 2 && t - samples[0][0] > 6000) samples.shift();
    }, 500);
    return () => clearInterval(tick);
  }, [phase]); // reset the window when the phase (and its counter meaning) changes

  useEffect(() => { samplesRef.current = []; }, [phase]);

  const samples = samplesRef.current;
  let rate = 0; // items per second over the rolling window
  if (samples.length >= 2) {
    const [t0, n0] = samples[0];
    const [t1, n1] = samples[samples.length - 1];
    if (t1 > t0) rate = Math.max(0, ((n1 - n0) / (t1 - t0)) * 1000);
  }
  const elapsed = now - startRef.current;
  const hasDeterminate = phase !== 'walking' && total > 0;
  const remaining = hasDeterminate && rate > 0.2 ? ((total - scanned) / rate) * 1000 : null;

  // ── Scan lifecycle (unchanged behavior) ─────────────────────────────────────
  useEffect(() => {
    if (!api) {
      let n = 0;
      const interval = setInterval(() => {
        n += Math.floor(Math.random() * 20) + 5;
        setScanned(n);
        if (n > 150) { setPhase('hashing'); setTotal(400); }
        if (n >= 400) {
          clearInterval(interval);
          onComplete({ groups: generateDemoGroups(mode), emptyFiles: [], totalScanned: n, totalHashed: 120, warnings: [], mode });
        }
      }, 100);
      return () => clearInterval(interval);
    }

    // Per-run lifecycle flag. In dev, <React.StrictMode> runs this effect twice
    // (setup → cleanup → setup). A ref shared across runs stays `true` after the
    // first cleanup, which silently drops all progress and skips onComplete —
    // i.e. a permanent spinner. A fresh local flag per run means the live scan
    // is never gagged by a previous run's teardown, and a torn-down run's late
    // result (e.g. from a terminated worker) can't hijack the screen.
    let active = true;
    cancelled.current = false; // clear any stale user-cancel state on (re)mount

    api.removeScanProgress();

    api.onScanProgress(({ scanned: n, phase: p, total: t, currentPath: cp }) => {
      if (!active || cancelled.current) return;
      if (typeof n === 'number') setScanned(n);
      if (p)                     setPhase(p);
      if (typeof t === 'number' && t > 0) setTotal(t);
      if (cp)                    setCurrentPath(cp);
    });

    api.startScan({ mode, protectedFolders, targetFolders, filters, autoMarkRule, includeEmpty })
      .then(result => {
        api.removeScanProgress();
        if (active && !cancelled.current) onComplete(result);
      })
      .catch(err => {
        api.removeScanProgress();
        if (active && !cancelled.current) {
          onComplete({ groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0, warnings: [{ path: '-', reason: err.message }], mode, error: err.message });
        }
      });

    return () => {
      active = false;
      api.removeScanProgress();
    };
  }, []); // eslint-disable-line

  const handleCancel = async () => {
    if (!api) { onCancel(); return; }
    setCancelling(true);
    cancelled.current = true;
    await api.cancelScan();
    onCancel();
  };

  // ── Phase copy ──────────────────────────────────────────────────────────────
  const phaseTitle = {
    walking:   'Scanning folders',
    hashing:   'Comparing file contents',
    verifying: 'Verifying matches',
  }[phase] ?? 'Scanning';

  const phaseHint = {
    walking:   'Counting and cataloguing files',
    hashing:   'Reading file boundaries only — most files never need a full transfer',
    verifying: 'Full checksum on files whose boundaries matched',
  }[phase];

  const counterLabel = phase === 'walking' ? 'files found' : phase === 'verifying' ? 'verified' : 'checked';

  // Progress ring: spinning while indeterminate; arc when determinate.
  const progressFraction = hasDeterminate ? Math.min(scanned / total, 1) : 0;
  const RADIUS = 66;
  const CIRC   = 2 * Math.PI * RADIUS;
  const arc    = hasDeterminate ? progressFraction * CIRC : 100;

  const displayPath = currentPath.length > 68 ? '…' + currentPath.slice(-68) : currentPath;

  const statBlock = { textAlign: 'center', minWidth: scale(110) };
  const statValue = { fontSize: 'var(--fs-title)', fontWeight: 500, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' };
  const statLabel = { fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginTop: scale(2) };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <style>{`@keyframes dff-spin { from { transform: rotate(-90deg); } to { transform: rotate(270deg); } }`}</style>
      <div style={{
        maxWidth: scale(680), margin: '0 auto', minHeight: '100%',
        padding: `${scale(36)}px ${scale(32)}px`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: scale(26),
      }}>

        {/* Progress ring */}
        <div style={{ position: 'relative', width: scale(160), height: scale(160) }}>
          <svg width={scale(160)} height={scale(160)} viewBox="0 0 160 160">
            <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="var(--bg-inset)" strokeWidth="7"/>
            <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="var(--accent)" strokeWidth="7"
              strokeDasharray={`${arc} ${CIRC}`} strokeLinecap="round"
              style={{
                transformOrigin: '80px 80px',
                transform: 'rotate(-90deg)',
                animation: hasDeterminate ? 'none' : 'dff-spin 1.1s linear infinite',
                transition: hasDeterminate ? 'stroke-dasharray 0.3s ease' : 'none',
              }}/>
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: scale(30), fontWeight: 500, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
              {hasDeterminate ? `${Math.round(progressFraction * 100)}%` : scanned.toLocaleString()}
            </span>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
              {hasDeterminate ? `${scanned.toLocaleString()} of ${total.toLocaleString()}` : counterLabel}
            </span>
          </div>
        </div>

        {/* Heading */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 500, marginBottom: scale(4) }}>{phaseTitle}</h1>
          <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>{phaseHint}</p>
        </div>

        {/* Throughput stats — the "is it slow?" answer */}
        <div style={{
          display: 'flex', gap: scale(10), justifyContent: 'center',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(22)}px`,
        }}>
          <div style={statBlock}>
            <div style={statValue}>{formatDuration(elapsed)}</div>
            <div style={statLabel}>Elapsed</div>
          </div>
          <div style={{ width: 1, background: 'var(--border)' }} />
          <div style={statBlock}>
            <div style={statValue}>{rate >= 10 ? Math.round(rate).toLocaleString() : rate.toFixed(1)}</div>
            <div style={statLabel}>files / second</div>
          </div>
          {remaining !== null && (
            <>
              <div style={{ width: 1, background: 'var(--border)' }} />
              <div style={statBlock}>
                <div style={statValue}>~{formatDuration(remaining)}</div>
                <div style={statLabel}>Remaining</div>
              </div>
            </>
          )}
        </div>

        {/* Live path ticker */}
        {currentPath && (
          <p title={currentPath} style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)',
            color: 'var(--text-muted)', maxWidth: '100%',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{displayPath}</p>
        )}

        {/* Folder summary */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(18)}px`,
          width: '100%', display: 'flex', flexDirection: 'column', gap: scale(10),
        }}>
          {mode === 'compare' && protectedFolders.length > 0 && (
            <FolderGroup label="Protected source" Icon={ShieldIcon} color="var(--accent)" folders={protectedFolders} scale={scale} />
          )}
          <FolderGroup
            label={mode === 'compare' ? 'Scan target' : mode === 'verify' ? 'Backup' : 'Scanning'}
            Icon={mode === 'compare' ? TargetIcon : SearchIcon}
            color={mode === 'compare' ? 'var(--danger)' : 'var(--accent)'}
            folders={targetFolders} scale={scale}
          />
        </div>

        <button onClick={handleCancel} disabled={cancelling} style={{
          background: 'transparent', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
          padding: `${scale(8)}px ${scale(24)}px`, fontSize: 'var(--fs-secondary)',
          cursor: cancelling ? 'default' : 'pointer',
          opacity: cancelling ? 0.5 : 1,
        }}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>

      </div>
    </div>
  );
}

function FolderGroup({ label, Icon, color, folders, scale }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: scale(6), marginBottom: scale(4) }}>
        <Icon size={scale(15)} color={color} />
        <span style={{ fontSize: 'var(--fs-secondary)', fontWeight: 500 }}>{label}</span>
      </div>
      {folders.map(f => (
        <div key={f} style={{ display: 'flex', alignItems: 'center', gap: scale(7), marginLeft: scale(2), marginBottom: scale(2) }}>
          <FolderIcon size={scale(13)} color="var(--text-muted)" />
          <span title={f} style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            direction: 'rtl', textAlign: 'left',
          }}>{f}</span>
        </div>
      ))}
    </div>
  );
}

function generateDemoGroups(mode) {
  const exts = ['.jpg', '.mp3', '.pdf', '.docx', '.mp4', '.png'];
  return Array.from({ length: 10 }, (_, i) => {
    const ext  = exts[i % exts.length];
    const size = Math.floor(Math.random() * 5000000) + 50000;
    const count = Math.floor(Math.random() * 2) + 2;
    const hasProtected = mode === 'compare' && i % 3 !== 0;
    const files = Array.from({ length: count }, (_, j) => ({
      path: j === 0 && hasProtected
        ? `C:\Backup\protected_file_${i}${ext}`
        : `C:\Users\Demo\Downloads\file_${i}_copy${j}${ext}`,
      name: j === 0 && hasProtected ? `protected_file_${i}${ext}` : `file_${i}_copy${j}${ext}`,
      size,
      modified: new Date(Date.now() - j * 86400000 * 3).toISOString(),
      ext,
      sourceLabel: j === 0 && hasProtected ? 'protected' : 'target',
    }));
    const autoMarked = files.filter(f => f.sourceLabel === 'target').slice(hasProtected ? 0 : 1).map(f => f.path);
    return { id: i, hash: `demo_${i}`, files, autoMarked, hasProtected };
  });
}