import React, { useEffect, useRef, useState } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';

const api = window.electronAPI;

export default function ScanView({ scanConfig, onComplete, onCancel }) {
  const { scale } = useDPR();
  const { mode, protectedFolders = [], targetFolders = [], filters = {}, autoMarkRule, includeEmpty } = scanConfig || {};

  const [scanned,     setScanned]     = useState(0);
  const [total,       setTotal]       = useState(0);
  // phase: 'walking' | 'hashing' | 'verifying'
  const [phase,       setPhase]       = useState('walking');
  const [currentPath, setCurrentPath] = useState('');
  const [dots,        setDots]        = useState('');
  const [cancelling,  setCancelling]  = useState(false);
  const cancelled = useRef(false);

  // Animated ellipsis
  useEffect(() => {
    const i = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!api) {
      // Demo mode (no Electron)
      let n = 0;
      const interval = setInterval(() => {
        n += Math.floor(Math.random() * 20) + 5;
        setScanned(n);
        if (n > 150) setPhase('hashing');
        if (n >= 400) {
          clearInterval(interval);
          onComplete({ groups: generateDemoGroups(mode), emptyFiles: [], totalScanned: n, totalHashed: 120, warnings: [], mode });
        }
      }, 100);
      return () => clearInterval(interval);
    }

    api.onScanProgress(({ scanned: n, phase: p, total: t, currentPath: cp }) => {
      if (cancelled.current) return;
      setScanned(n);
      if (p)              setPhase(p);
      if (t)              setTotal(t);
      if (cp !== undefined) setCurrentPath(cp);
    });

    api.startScan({ mode, protectedFolders, targetFolders, filters, autoMarkRule, includeEmpty })
      .then(result => {
        api.removeScanProgress();
        if (!cancelled.current) onComplete(result);
      })
      .catch(err => {
        api.removeScanProgress();
        if (!cancelled.current) {
          onComplete({ groups: [], emptyFiles: [], totalScanned: scanned, totalHashed: 0, warnings: [{ path: '-', reason: err.message }], mode, error: err.message });
        }
      });

    return () => {
      cancelled.current = true;
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

  // ── Phase labels ────────────────────────────────────────────────────────────
  const phaseTitle = {
    walking:   'Scanning for duplicates',
    hashing:   'Comparing file contents',
    verifying: 'Verifying matches',
  }[phase] ?? 'Scanning';

  const phaseSubLabel = {
    walking:   'Scanning folders',
    hashing:   total > 0 ? `Boundary-checking ${scanned.toLocaleString()} of ${total.toLocaleString()} candidate files` : 'Checking file boundaries',
    verifying: total > 0 ? `Full verify: ${scanned.toLocaleString()} of ${total.toLocaleString()} files` : 'Verifying duplicates',
  }[phase] ?? '';

  const phaseHint = {
    walking:   null,
    hashing:   'Reading file boundaries only — avoids full network transfer for most files',
    verifying: 'Full SHA-256 — only files with matching boundaries reach this step',
  }[phase];

  // Progress ring: spinning during walking; determinate arc during hashing/verifying.
  const hasDeterminate = phase !== 'walking' && total > 0;
  const progressFraction = hasDeterminate ? Math.min(scanned / total, 1) : 0;
  const RADIUS = 52;
  const CIRC   = 2 * Math.PI * RADIUS;
  const arc    = hasDeterminate ? progressFraction * CIRC : 80;

  // Truncate long paths for display
  const displayPath = currentPath.length > 62
    ? '…' + currentPath.slice(-62)
    : currentPath;

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: scale(24), padding: scale(40),
    }}>
      <style>{`
        @keyframes spin   { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
        @keyframes spin-r { from { transform: rotate(0deg);   } to { transform: rotate(-360deg); } }
      `}</style>

      {/* ── Progress ring ── */}
      <div style={{ position: 'relative', width: scale(120), height: scale(120) }}>
        <svg width={scale(120)} height={scale(120)} viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2"/>
          <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--teal)" strokeWidth="2"
            strokeDasharray={`${arc} ${CIRC}`}
            strokeLinecap="round"
            style={{
              transformOrigin: '60px 60px',
              transform: 'rotate(-90deg)',
              animation: hasDeterminate ? 'none' : 'spin 1.2s linear infinite',
              transition: hasDeterminate ? 'stroke-dasharray 0.3s ease' : 'none',
            }}/>
          <circle cx="60" cy="60" r="36" fill="none" stroke="var(--border)" strokeWidth="1"/>
          <circle cx="60" cy="60" r="36" fill="none" stroke="var(--teal)" strokeWidth="1.5"
            strokeDasharray="40 186" strokeLinecap="round"
            style={{
              transformOrigin: '60px 60px',
              animation: phase === 'walking' ? 'spin-r 0.8s linear infinite' : 'none',
              opacity: phase === 'walking' ? 1 : 0.35,
            }}/>
          <text x="60" y="58" textAnchor="middle" fontSize={scale(13)} fill="var(--teal)"
            fontFamily="var(--font-mono)" fontWeight="600">{scanned.toLocaleString()}</text>
          <text x="60" y="70" textAnchor="middle" fontSize={scale(8)} fill="var(--text-muted)"
            fontFamily="var(--font-mono)">
            {phase === 'walking' ? 'found' : phase === 'verifying' ? 'verified' : 'checked'}
          </text>
          {hasDeterminate && (
            <text x="60" y="80" textAnchor="middle" fontSize={scale(7)} fill="var(--text-muted)"
              fontFamily="var(--font-mono)">of {total.toLocaleString()}</text>
          )}
        </svg>
      </div>

      {/* ── Phase heading ── */}
      <div style={{ textAlign: 'center', maxWidth: 520 }}>
        <h2 style={{ fontSize: scale(18), fontWeight: 600, marginBottom: scale(6) }}>
          {phaseTitle}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: scale(13), marginBottom: scale(4) }}>
          {phaseSubLabel}{dots}
        </p>
        {phaseHint && (
          <p style={{ color: 'var(--text-muted)', fontSize: scale(11) }}>{phaseHint}</p>
        )}
      </div>

      {/* ── Live current-path ticker ── */}
      {currentPath && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: `${scale(6)}px ${scale(14)}px`,
          maxWidth: 520, width: '100%',
        }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: scale(10),
            color: 'var(--text-muted)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <span style={{ color: 'var(--teal)', marginRight: scale(6) }}>▶</span>
            {displayPath}
          </p>
        </div>
      )}

      {/* ── Folder summary card ── */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(20)}px`,
        maxWidth: 520, width: '100%',
      }}>
        {mode === 'compare' && protectedFolders.length > 0 && (
          <div style={{ marginBottom: scale(10) }}>
            <p style={{ fontSize: scale(10), color: 'var(--teal)', fontWeight: 600, marginBottom: scale(4), letterSpacing: '0.06em' }}>
              🛡 PROTECTED
            </p>
            {protectedFolders.map(f => (
              <p key={f} style={{ fontFamily: 'var(--font-mono)', fontSize: scale(11), color: 'var(--text-secondary)', marginBottom: scale(2) }}>📂 {f}</p>
            ))}
          </div>
        )}
        <div>
          <p style={{ fontSize: scale(10), color: 'var(--red)', fontWeight: 600, marginBottom: scale(4), letterSpacing: '0.06em' }}>
            {mode === 'compare' ? '🎯 TARGET' : '🔍 SCANNING'}
          </p>
          {targetFolders.map(f => (
            <p key={f} style={{ fontFamily: 'var(--font-mono)', fontSize: scale(11), color: 'var(--text-secondary)', marginBottom: scale(2) }}>📂 {f}</p>
          ))}
        </div>
      </div>

      <button onClick={handleCancel} disabled={cancelling} style={{
        background: 'transparent', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
        padding: `${scale(7)}px ${scale(20)}px`, fontSize: scale(12),
        cursor: cancelling ? 'default' : 'pointer',
        opacity: cancelling ? 0.5 : 1,
      }}>
        {cancelling ? 'Cancelling…' : 'Cancel'}
      </button>
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
        ? `C:\\Backup\\protected_file_${i}${ext}`
        : `C:\\Users\\Demo\\Downloads\\file_${i}_copy${j}${ext}`,
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
