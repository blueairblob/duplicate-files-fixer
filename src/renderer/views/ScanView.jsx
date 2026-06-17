import React, { useEffect, useRef, useState } from 'react';

const api = window.electronAPI;

export default function ScanView({ folders, filters, onComplete, onCancel }) {
  const [scanned, setScanned] = useState(0);
  const [status, setStatus] = useState('Initialising scan…');
  const [dots, setDots] = useState('');
  const cancelled = useRef(false);

  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 400);
    return () => clearInterval(dotInterval);
  }, []);

  useEffect(() => {
    if (!api) {
      // Demo mode (no Electron): simulate scan
      let n = 0;
      const interval = setInterval(() => {
        n += Math.floor(Math.random() * 30) + 5;
        setScanned(n);
        setStatus(`Scanning files${dots}`);
        if (n >= 500) {
          clearInterval(interval);
          onComplete({
            groups: generateDemoGroups(),
            totalScanned: n,
          });
        }
      }, 120);
      return () => clearInterval(interval);
    }

    api.onScanProgress(({ scanned: n }) => {
      if (!cancelled.current) {
        setScanned(n);
        setStatus(`Scanning files${dots}`);
      }
    });

    api.startScan({ folders, filters }).then(result => {
      api.removeScanProgress();
      if (!cancelled.current) onComplete(result);
    });

    return () => {
      cancelled.current = true;
      api.removeScanProgress();
    };
  }, []); // eslint-disable-line

  return (
    <div style={{
      height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 32, padding: 40,
    }}>
      {/* Animated scanner graphic */}
      <div style={{ position: 'relative', width: 120, height: 120 }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="2"/>
          <circle
            cx="60" cy="60" r="52"
            fill="none"
            stroke="var(--teal)"
            strokeWidth="2"
            strokeDasharray="80 246"
            strokeLinecap="round"
            style={{ transformOrigin: '60px 60px', animation: 'spin 1.2s linear infinite' }}
          />
          <circle cx="60" cy="60" r="38" fill="none" stroke="var(--border)" strokeWidth="1"/>
          <circle
            cx="60" cy="60" r="38"
            fill="none"
            stroke="var(--teal)"
            strokeWidth="1.5"
            strokeDasharray="40 199"
            strokeLinecap="round"
            style={{ transformOrigin: '60px 60px', animation: 'spin 0.8s linear infinite reverse' }}
          />
          <text x="60" y="64" textAnchor="middle" fontSize="11" fill="var(--teal)" fontFamily="var(--font-mono)">
            {scanned}
          </text>
          <text x="60" y="75" textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            files
          </text>
        </svg>
        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Scanning for duplicates</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{status}{dots}</p>
      </div>

      {/* Folders being scanned */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 20px',
        maxWidth: 480, width: '100%',
      }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Scanning</p>
        {folders.map(f => (
          <p key={f} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>
            📂 {f}
          </p>
        ))}
      </div>

      <button
        onClick={onCancel}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-muted)',
          padding: '7px 20px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}

// Demo data when running outside Electron
function generateDemoGroups() {
  const exts = ['.jpg', '.mp3', '.pdf', '.docx', '.mp4', '.png'];
  const groups = [];
  for (let i = 0; i < 12; i++) {
    const ext = exts[i % exts.length];
    const size = Math.floor(Math.random() * 5000000) + 50000;
    const count = Math.floor(Math.random() * 3) + 2;
    groups.push({
      id: i,
      hash: `demo_hash_${i}`,
      files: Array.from({ length: count }, (_, j) => ({
        path: `C:\\Users\\Demo\\Documents\\file_${i}_copy${j}${ext}`,
        name: `file_${i}_copy${j}${ext}`,
        size,
        modified: new Date(Date.now() - j * 86400000 * 3).toISOString(),
        ext,
      })),
    });
  }
  return groups;
}
