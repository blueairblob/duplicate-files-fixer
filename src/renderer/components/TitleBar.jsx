import React from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { SidebarIcon } from './icons.jsx';

const api = window.electronAPI;

// Frameless-window toolbar. Left: sidebar toggle. Center: view title.
// Right: window controls (kept — the window is frameless so these are the
// only min/max/close affordances on Windows/Linux).
export default function TitleBar({ title = 'Duplicate Files Fixer', onToggleSidebar }) {
  const { scale } = useDPR();

  const winBtn = {
    width: scale(30), height: scale(24),
    background: 'transparent', borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)', fontSize: scale(13),
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{
      height: 'var(--titlebar-h)',
      background: 'var(--bg-window)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: `0 ${scale(12)}px`,
      WebkitAppRegion: 'drag',
      flexShrink: 0, zIndex: 100,
    }}>
      <button
        onClick={onToggleSidebar}
        title="Show or hide sidebar"
        style={{ ...winBtn, WebkitAppRegion: 'no-drag' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <SidebarIcon size={scale(17)} />
      </button>

      <span style={{
        flex: 1, textAlign: 'center',
        fontSize: 'var(--fs-secondary)', fontWeight: 500, color: 'var(--text-primary)',
      }}>{title}</span>

      {api ? (
        <div style={{ display: 'flex', gap: scale(2), WebkitAppRegion: 'no-drag' }}>
          {[
            { label: '–', action: () => api.windowMinimize() },
            { label: '□', action: () => api.windowMaximize() },
            { label: '×', action: () => api.windowClose(), danger: true },
          ].map(({ label, action, danger }) => (
            <button key={label} onClick={action}
              style={{ ...winBtn, fontSize: label === '□' ? scale(10) : scale(14) }}
              onMouseEnter={e => {
                e.currentTarget.style.background = danger ? 'var(--danger)' : 'var(--bg-hover)';
                if (danger) e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >{label}</button>
          ))}
        </div>
      ) : (
        <span style={{ width: scale(30) }} />
      )}
    </div>
  );
}
