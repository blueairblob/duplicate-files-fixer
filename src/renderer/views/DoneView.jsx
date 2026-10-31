import React, { useEffect, useState } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function DoneView({ deleteResult, onScanAgain }) {
  const { scale } = useDPR();
  const { trashed = [], quarantined = [], failed = [], skipped = [], freedBytes = 0, totalScanned = 0 } = deleteResult || {};
  // Every outcome is reported separately; nothing is ever permanently deleted.
  const removed = trashed.length + quarantined.length;
  const allDone = removed > 0 && skipped.length === 0 && failed.length === 0;
  const [count, setCount] = useState(0);

  // Animate the counter
  useEffect(() => {
    const target = removed;
    if (target === 0) return;
    let current = 0;
    const step = Math.max(1, Math.floor(target / 30));
    const interval = setInterval(() => {
      current = Math.min(current + step, target);
      setCount(current);
      if (current >= target) clearInterval(interval);
    }, 30);
    return () => clearInterval(interval);
  }, [removed]);

  return (
    <div style={{
      height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: scale(28), padding: scale(40),
    }}>

      {/* Success ring */}
      <div style={{ position: 'relative', width: scale(120), height: scale(120) }}>
        <svg width={scale(120)} height={scale(120)} viewBox="0 0 120 120">
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
          <div style={{ fontSize: scale(28), fontWeight: 700, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>{count}</div>
          <div style={{ fontSize: scale(9), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>DELETED</div>
        </div>
      </div>

      {/* Headline */}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: scale(22), fontWeight: 700, marginBottom: scale(6) }}>
          {deleteResult?.cancelled ? 'Stopped' : allDone ? 'All cleaned up' : removed > 0 ? 'Partly done' : 'Nothing was deleted'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: scale(13) }}>
          {removed > 0
            ? `Removed ${removed.toLocaleString()} file${removed !== 1 ? 's' : ''} — all of them recoverable`
            : 'Every selected file was left in place. See below for why.'}
        </p>
      </div>

      {/* Stats */}
      <div style={{
        display: 'flex', gap: scale(16),
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        {[
          { label: 'Space freed', value: formatSize(freedBytes), color: 'var(--teal)' },
          { label: 'Files removed', value: removed, color: 'var(--text-primary)' },
          { label: 'Not deleted', value: skipped.length + failed.length, color: skipped.length + failed.length > 0 ? 'var(--amber)' : 'var(--text-muted)' },
          { label: 'Files scanned', value: totalScanned.toLocaleString(), color: 'var(--text-primary)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: `${scale(20)}px ${scale(24)}px`, textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: scale(22), fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
            <div style={{ fontSize: scale(10), color: 'var(--text-muted)', marginTop: scale(4), textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
          </div>
        ))}
      </div>

      {skipped.length > 0 && (
        <div style={{
          background: 'var(--amber-dim)',
          border: '1px solid var(--amber)',
          borderRadius: 'var(--radius-sm)',
          padding: `${scale(12)}px ${scale(18)}px`,
          fontSize: scale(12), color: 'var(--amber)',
          maxWidth: 480,
        }}>
          <div style={{ fontWeight: 600, marginBottom: scale(6) }}>
            {skipped.length} file{skipped.length !== 1 ? 's' : ''} NOT deleted — a safety check stopped {skipped.length !== 1 ? 'them' : 'it'}:
          </div>
          {skipped.slice(0, 5).map(sk => (
            <div key={sk.path} style={{ fontFamily: 'var(--font-mono)', fontSize: scale(11), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${sk.path} — ${sk.reason}`}>
              {sk.reason}: {sk.path}
            </div>
          ))}
          {skipped.length > 5 && <div style={{ marginTop: scale(4) }}>…and {skipped.length - 5} more</div>}
        </div>
      )}

      {/* Recycle bin / quarantine note */}
      {trashed.length > 0 && (
        <div style={{
          background: 'var(--teal-dim)',
          border: '1px solid var(--teal)',
          borderRadius: 'var(--radius-sm)',
          padding: `${scale(10)}px ${scale(18)}px`,
          fontSize: scale(12), color: 'var(--teal)',
          maxWidth: 400, textAlign: 'center',
        }}>
          ♻ {trashed.length.toLocaleString()} file{trashed.length !== 1 ? 's were' : ' was'} moved to the Recycle Bin — you can still recover them if needed.
        </div>
      )}

      {quarantined.length > 0 && (
        <div style={{
          background: 'var(--amber-dim)',
          border: '1px solid var(--amber)',
          borderRadius: 'var(--radius-sm)',
          padding: `${scale(10)}px ${scale(18)}px`,
          fontSize: scale(12), color: 'var(--amber)',
          maxWidth: 440, textAlign: 'center',
        }}>
          🛡 {quarantined.length.toLocaleString()} file{quarantined.length !== 1 ? 's' : ''} couldn't go to the Recycle Bin (network drives
          don't have one) and {quarantined.length !== 1 ? 'were' : 'was'} moved to a .holdfast-quarantine folder on the same drive instead.
          Restore {quarantined.length !== 1 ? 'them' : 'it'} from Quarantine in the sidebar.
        </div>
      )}

      {/* Failures */}
      {failed.length > 0 && (
        <div style={{
          background: 'var(--red-dim)', border: '1px solid var(--red)',
          borderRadius: 'var(--radius-sm)', padding: `${scale(10)}px ${scale(18)}px`,
          fontSize: scale(11), color: 'var(--red)', maxWidth: 440,
        }}>
          <strong>{failed.length} file{failed.length !== 1 ? 's' : ''} could not be moved anywhere recoverable, so {failed.length !== 1 ? 'they were' : 'it was'} left in place.</strong>
          <div style={{ marginTop: scale(6) }}>
            {failed.slice(0, 3).map(f => (
              <div key={f.path} style={{ fontFamily: 'var(--font-mono)', fontSize: scale(10), color: 'var(--text-secondary)', marginTop: scale(2) }}>
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
          padding: `${scale(11)}px ${scale(28)}px`,
          fontSize: scale(13),
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Scan again
      </button>
    </div>
  );
}
