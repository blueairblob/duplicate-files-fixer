import React, { useEffect, useState } from 'react';

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function DoneView({ deleteResult, onScanAgain }) {
  const { deleted = [], failed = [], quarantined = [], markedBytes = 0, totalScanned = 0 } = deleteResult || {};
  const [count, setCount] = useState(0);

  // Animate the counter
  useEffect(() => {
    const target = deleted.length;
    if (target === 0) return;
    let current = 0;
    const step = Math.max(1, Math.floor(target / 30));
    const interval = setInterval(() => {
      current = Math.min(current + step, target);
      setCount(current);
      if (current >= target) clearInterval(interval);
    }, 30);
    return () => clearInterval(interval);
  }, [deleted.length]);

  return (
    <div style={{
      height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 28, padding: 40,
    }}>

      {/* Success ring */}
      <div style={{ position: 'relative', width: 120, height: 120 }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="2"/>
          <circle
            cx="60" cy="60" r="52"
            fill="none"
            stroke="var(--teal)"
            strokeWidth="3"
            strokeDasharray="326"
            strokeDashoffset="0"
            strokeLinecap="round"
            style={{ transformOrigin: '60px 60px', transform: 'rotate(-90deg)', transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>{count}</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>DELETED</div>
        </div>
      </div>

      {/* Headline */}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          {deleted.length > 0 ? 'All cleaned up' : 'Nothing was deleted'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {deleted.length > 0
            ? `Moved ${deleted.length} file${deleted.length !== 1 ? 's' : ''} to the Recycle Bin`
            : 'No files were selected for deletion.'}
        </p>
      </div>

      {/* Stats */}
      <div style={{
        display: 'flex', gap: 16,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        {[
          { label: 'Space freed', value: formatSize(markedBytes), color: 'var(--teal)' },
          { label: 'Files removed', value: deleted.length, color: 'var(--text-primary)' },
          { label: 'Failed', value: failed.length, color: failed.length > 0 ? 'var(--red)' : 'var(--text-muted)' },
          { label: 'Files scanned', value: totalScanned.toLocaleString(), color: 'var(--text-primary)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: '20px 24px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Recycle bin / quarantine note */}
      {deleted.length > 0 && quarantined.length === 0 && (
        <div style={{
          background: 'var(--teal-dim)',
          border: '1px solid var(--teal)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 18px',
          fontSize: 12, color: 'var(--teal)',
          maxWidth: 400, textAlign: 'center',
        }}>
          ♻ Files were moved to the Recycle Bin — you can still recover them if needed.
        </div>
      )}

      {quarantined.length > 0 && (
        <div style={{
          background: 'var(--amber-dim)',
          border: '1px solid var(--amber)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 18px',
          fontSize: 12, color: 'var(--amber)',
          maxWidth: 440, textAlign: 'center',
        }}>
          🛡 {quarantined.length} file{quarantined.length !== 1 ? 's' : ''} couldn't reach the system Recycle Bin
          and {quarantined.length !== 1 ? 'were' : 'was'} moved to an in-app quarantine folder instead — still fully recoverable.
        </div>
      )}

      {/* Failures */}
      {failed.length > 0 && (
        <div style={{
          background: 'var(--red-dim)', border: '1px solid var(--red)',
          borderRadius: 'var(--radius-sm)', padding: '10px 18px',
          fontSize: 11, color: 'var(--red)', maxWidth: 440,
        }}>
          <strong>{failed.length} file{failed.length !== 1 ? 's' : ''} could not be deleted.</strong>
          <div style={{ marginTop: 6 }}>
            {failed.slice(0, 3).map(f => (
              <div key={f.path} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                {f.path}: {f.error}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onScanAgain}
        style={{
          background: 'var(--teal)',
          color: '#0d0f14',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: '11px 28px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Scan again
      </button>
    </div>
  );
}
