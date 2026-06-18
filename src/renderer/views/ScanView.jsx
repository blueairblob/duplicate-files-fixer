import React, { useEffect, useRef, useState } from 'react';

const api = window.electronAPI;

export default function ScanView({ scanConfig, onComplete, onCancel }) {
  const { mode, protectedFolders = [], targetFolders = [], filters = {}, autoMarkRule } = scanConfig || {};
  const allFolders = [...(protectedFolders || []), ...(targetFolders || [])];

  const [scanned, setScanned] = useState(0);
  const [phase, setPhase] = useState(mode === 'compare' ? 'Scanning protected source…' : 'Scanning files…');
  const [dots, setDots] = useState('');
  const cancelled = useRef(false);

  useEffect(() => {
    const i = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!api) {
      // Demo mode
      let n = 0;
      const interval = setInterval(() => {
        n += Math.floor(Math.random() * 20) + 5;
        setScanned(n);
        if (n > 150 && mode === 'compare') setPhase('Scanning target folders…');
        if (n >= 400) {
          clearInterval(interval);
          onComplete({ groups: generateDemoGroups(mode), totalScanned: n, mode });
        }
      }, 100);
      return () => clearInterval(interval);
    }

    api.onScanProgress(({ scanned: n }) => {
      if (cancelled.current) return;
      setScanned(n);
      if (n > 100 && mode === 'compare') setPhase('Scanning target folders…');
    });

    api.startScan({ mode, protectedFolders, targetFolders, filters, autoMarkRule })
      .then(result => {
        api.removeScanProgress();
        if (!cancelled.current) onComplete(result);
      })
      .catch(err => {
        api.removeScanProgress();
        console.error('Scan error:', err);
        if (!cancelled.current) onComplete({ groups: [], totalScanned: scanned, mode, error: err.message });
      });

    return () => {
      cancelled.current = true;
      api.removeScanProgress();
    };
  }, []); // eslint-disable-line

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 28, padding: 40,
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ position: 'relative', width: 120, height: 120 }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="2"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--teal)" strokeWidth="2"
            strokeDasharray="80 246" strokeLinecap="round"
            style={{ transformOrigin: '60px 60px', animation: 'spin 1.2s linear infinite' }}/>
          <circle cx="60" cy="60" r="36" fill="none" stroke="var(--border)" strokeWidth="1"/>
          <circle cx="60" cy="60" r="36" fill="none" stroke="var(--teal)" strokeWidth="1.5"
            strokeDasharray="40 186" strokeLinecap="round"
            style={{ transformOrigin: '60px 60px', animation: 'spin 0.8s linear infinite reverse' }}/>
          <text x="60" y="63" textAnchor="middle" fontSize="14" fill="var(--teal)" fontFamily="var(--font-mono)" fontWeight="600">
            {scanned}
          </text>
          <text x="60" y="75" textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            files
          </text>
        </svg>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Scanning for duplicates</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{phase}{dots}</p>
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '14px 20px', maxWidth: 500, width: '100%',
      }}>
        {mode === 'compare' && protectedFolders.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 10, color: 'var(--teal)', fontWeight: 600, marginBottom: 4, letterSpacing: '0.06em' }}>🛡 PROTECTED</p>
            {protectedFolders.map(f => (
              <p key={f} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>📂 {f}</p>
            ))}
          </div>
        )}
        <div>
          <p style={{ fontSize: 10, color: 'var(--red)', fontWeight: 600, marginBottom: 4, letterSpacing: '0.06em' }}>🎯 {mode === 'compare' ? 'TARGET' : 'SCANNING'}</p>
          {targetFolders.map(f => (
            <p key={f} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>📂 {f}</p>
          ))}
        </div>
      </div>

      <button onClick={onCancel} style={{
        background: 'transparent', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
        padding: '7px 20px', fontSize: 12, cursor: 'pointer',
      }}>
        Cancel
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
