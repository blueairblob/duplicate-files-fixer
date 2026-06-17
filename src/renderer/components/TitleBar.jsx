import React from 'react';

const api = window.electronAPI;

export default function TitleBar() {
  return (
    <div style={{
      height: 'var(--titlebar-h)',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      WebkitAppRegion: 'drag',
      flexShrink: 0,
      zIndex: 100,
    }}>
      {/* Left: logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="2" stroke="var(--teal)" strokeWidth="1.5"/>
          <rect x="7" y="7" width="10" height="10" rx="2" fill="var(--bg-elevated)" stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="2 1.5"/>
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
          DUPLICATE FILES FIXER
        </span>
      </div>

      {/* Right: window controls */}
      {api && (
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
          {[
            { label: '–', action: () => api.windowMinimize(), color: '#f5a623' },
            { label: '□', action: () => api.windowMaximize(), color: '#00c4a0' },
            { label: '×', action: () => api.windowClose(), color: '#f05a5a' },
          ].map(({ label, action, color }) => (
            <button
              key={label}
              onClick={action}
              style={{
                width: 28, height: 22,
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color,
                fontSize: label === '□' ? 9 : 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
