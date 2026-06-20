import React, { useEffect, useRef, useState } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';

const api = window.electronAPI;

export default function ScanView({ scanConfig, onComplete, onCancel }) {
  const { scale } = useDPR();
  const { mode, protectedFolders = [], targetFolders = [], filters = {}, autoMarkRule, includeEmpty } = scanConfig || {};

  const [scanned, setScanned] = useState(0);
  const [phase, setPhase] = useState('walking'); // 'walking' | 'hashing'
  const [hashTotal, setHashTotal] = useState(0);
  const [dots, setDots] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const cancelled = useRef(false);

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

    api.onScanProgress(({ scanned: n, phase: p, total }) => {
      if (cancelled.current) return;
      setScanned(n);
      if (p) setPhase(p);
      if (total) setHashTotal(total);
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
    if (!api) {
      onCancel();
      return;
    }
    setCancelling(true);
    cancelled.current = true;
    await api.cancelScan();
    onCancel();
  };

  const phaseLabel = phase === 'hashing'
    ? (hashTotal > 0 ? `Comparing ${scanned} of ${hashTotal} candidate files` : 'Comparing file contents')
    : 'Scanning folders';

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: scale(28), padding: scale(40),
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ position: 'relative', width: scale(120), height: scale(120) }}>
        <svg width={scale(120)} height={scale(120)} viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="2"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--teal)" strokeWidth="2"
            strokeDasharray="80 246" strokeLinecap="round"
            style={{ transformOrigin: '60px 60px', animation: 'spin 1.2s linear infinite' }}/>
          <circle cx="60" cy="60" r="36" fill="none" stroke="var(--border)" strokeWidth="1"/>
          <circle cx="60" cy="60" r="36" fill="none" stroke="var(--teal)" strokeWidth="1.5"
            strokeDasharray="40 186" strokeLinecap="round"
            style={{ transformOrigin: '60px 60px', animation: 'spin 0.8s linear infinite reverse' }}/>
          <text x="60" y="63" textAnchor="middle" fontSize={scale(14)} fill="var(--teal)" fontFamily="var(--font-mono)" fontWeight="600">
            {scanned}
          </text>
          <text x="60" y="75" textAnchor="middle" fontSize={scale(8)} fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {phase === 'hashing' ? 'compared' : 'files'}
          </text>
        </svg>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: scale(18), fontWeight: 600, marginBottom: scale(6) }}>
          {phase === 'hashing' ? 'Comparing file contents' : 'Scanning for duplicates'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: scale(13) }}>{phaseLabel}{dots}</p>
        {phase === 'hashing' && (
          <p style={{ color: 'var(--text-muted)', fontSize: scale(11), marginTop: scale(4) }}>
            Only files that share an identical size are compared — SHA-256
          </p>
        )}
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(20)}px`, maxWidth: 500, width: '100%',
      }}>
        {mode === 'compare' && protectedFolders.length > 0 && (
          <div style={{ marginBottom: scale(10) }}>
            <p style={{ fontSize: scale(10), color: 'var(--teal)', fontWeight: 600, marginBottom: scale(4), letterSpacing: '0.06em' }}>🛡 PROTECTED</p>
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
        padding: `${scale(7)}px ${scale(20)}px`, fontSize: scale(12), cursor: cancelling ? 'default' : 'pointer',
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
    const ext = exts[i % exts.length];
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
