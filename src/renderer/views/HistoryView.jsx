import React from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { entryTitle, entrySubtitle, CONFIDENCE_SHORT } from '../utils/scanHistory.js';
import { ShieldIcon, TargetIcon, SearchIcon, XIcon, ArrowRightIcon, HistoryIcon } from '../components/icons.jsx';

// History section page. Clicking "Load setup" (or the row) seeds New scan
// with the entry's mode + folders via onLoadEntry.
export default function HistoryView({ entries, onLoadEntry, onRemoveEntry, onClearAll }) {
  const { scale } = useDPR();

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: scale(680), margin: '0 auto', padding: `${scale(28)}px ${scale(32)}px` }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: scale(12) }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 500, marginBottom: scale(4) }}>History</h1>
            <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', marginBottom: scale(24) }}>
              Click a scan to reload its folders into a new scan.
            </p>
          </div>
          {entries.length > 0 && (
            <button onClick={onClearAll} style={{
              background: 'transparent', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
              padding: `${scale(6)}px ${scale(12)}px`, fontSize: 'var(--fs-caption)', flexShrink: 0,
            }}>Clear all</button>
          )}
        </div>

        {entries.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: scale(8),
            padding: `${scale(48)}px 0`, color: 'var(--text-muted)',
          }}>
            <HistoryIcon size={scale(28)} color="var(--text-muted)" />
            <p style={{ fontSize: 'var(--fs-secondary)' }}>No scans yet — completed scans will appear here.</p>
          </div>
        ) : (
          <div style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-card)', overflow: 'hidden',
          }}>
            {entries.map((e, i) => {
              const ModeIcon = e.mode === 'simple' ? SearchIcon : e.mode === 'verify' ? ShieldIcon : TargetIcon;
              return (
                <div key={e.id}
                  onClick={() => onLoadEntry(e)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: scale(12),
                    padding: `${scale(12)}px ${scale(16)}px`, cursor: 'pointer',
                    borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
                >
                  <ModeIcon size={scale(17)} color="var(--accent)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 'var(--fs-secondary)', fontWeight: 500, margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{entryTitle(e)}</p>
                    <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', margin: `${scale(1)}px 0 0` }}>
                      {entrySubtitle(e)}{e.status === 'complete' ? ` · ${e.totalScanned.toLocaleString()} files scanned` : ''}
                    </p>
                  </div>
                  <span style={{
                    fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)',
                    background: 'var(--bg-inset)', borderRadius: scale(10),
                    padding: `0 ${scale(8)}px`, lineHeight: `${scale(18)}px`, flexShrink: 0,
                  }}>{CONFIDENCE_SHORT[e.confidence] || 'Standard'}</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: scale(4),
                    fontSize: 'var(--fs-caption)', color: 'var(--accent)', flexShrink: 0,
                  }}>
                    Load setup <ArrowRightIcon size={scale(12)} />
                  </span>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); onRemoveEntry(e.id); }}
                    title="Remove from history"
                    style={{ background: 'transparent', color: 'var(--text-muted)', display: 'flex', padding: scale(4) }}
                  >
                    <XIcon size={scale(13)} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
