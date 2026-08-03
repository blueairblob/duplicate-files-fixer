import React from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { CopyIcon, HistoryIcon, ArchiveIcon, BanIcon, SettingsIcon, SearchIcon, CheckCircleIcon } from './icons.jsx';

// macOS "source list" sidebar. Collapsible via the toolbar toggle in App.jsx.
// `section` / `onSelectSection` are owned by App so the sidebar persists
// across the scan → results state machine.
const NAV = [
  { id: 'scan',       label: 'New scan',   Icon: CopyIcon },
  { id: 'history',    label: 'History',    Icon: HistoryIcon },
  { id: 'quarantine', label: 'Quarantine', Icon: ArchiveIcon },
  { id: 'exclusions', label: 'Exclusions', Icon: BanIcon },
];

export default function Sidebar({ section, onSelectSection, onSelectRecent, recentScans = [], quarantineCount = 0, scanActivity = null, onSelectActivity }) {
  const { scale } = useDPR();

  const itemStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: scale(9), width: '100%',
    padding: `${scale(6)}px ${scale(10)}px`, borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--accent-tint)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-primary)',
    fontSize: 'var(--fs-secondary)', fontWeight: active ? 500 : 400,
    textAlign: 'left', marginBottom: scale(1),
  });

  return (
    <div style={{
      width: 'var(--sidebar-w)', flexShrink: 0, height: '100%',
      background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: `${scale(10)}px ${scale(8)}px`,
    }}>
      {NAV.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => onSelectSection(id)} style={itemStyle(section === id)}
          onMouseEnter={e => { if (section !== id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={e => { if (section !== id) e.currentTarget.style.background = 'transparent'; }}
        >
          <Icon size={scale(16)} color={section === id ? 'var(--accent)' : 'var(--text-secondary)'} />
          <span style={{ flex: 1 }}>{label}</span>
          {id === 'quarantine' && quarantineCount > 0 && (
            <span style={{
              fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)',
              background: 'var(--bg-inset)', borderRadius: 10,
              padding: `0 ${scale(7)}px`, lineHeight: `${scale(18)}px`,
            }}>{quarantineCount}</span>
          )}
        </button>
      ))}

      {scanActivity && (
        <button onClick={onSelectActivity} style={{ ...itemStyle(section === 'activity'), marginTop: scale(10) }}
          onMouseEnter={e => { if (section !== 'activity') e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={e => { if (section !== 'activity') e.currentTarget.style.background = 'transparent'; }}
        >
          {scanActivity.status === 'running'
            ? <SearchIcon size={scale(16)} color="var(--accent)" />
            : <CheckCircleIcon size={scale(16)} color="var(--success)" />}
          <span style={{ flex: 1 }}>
            {scanActivity.status === 'running'
              ? (scanActivity.pct != null ? `Scanning · ${scanActivity.pct}%` : 'Scanning…')
              : 'Comparison ready'}
          </span>
          {scanActivity.status === 'complete' && scanActivity.groups != null && (
            <span style={{
              fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)',
              background: 'var(--bg-inset)', borderRadius: 10,
              padding: `0 ${scale(7)}px`, lineHeight: `${scale(18)}px`,
            }}>{scanActivity.groups}</span>
          )}
        </button>
      )}

      {recentScans.length > 0 && (
        <>
          <p style={{
            fontSize: 'var(--fs-caption)', fontWeight: 500, color: 'var(--text-muted)',
            margin: `${scale(16)}px ${scale(10)}px ${scale(4)}px`,
          }}>Recent</p>
          {recentScans.map((s) => (
            <button key={s.id} onClick={() => onSelectRecent && onSelectRecent(s.entry)}
              style={{ ...itemStyle(false), display: 'block' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
                {s.subtitle}
              </span>
            </button>
          ))}
        </>
      )}

      <button onClick={() => onSelectSection('settings')} style={{ ...itemStyle(section === 'settings'), marginTop: 'auto' }}
        onMouseEnter={e => { if (section !== 'settings') e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (section !== 'settings') e.currentTarget.style.background = 'transparent'; }}
      >
        <SettingsIcon size={scale(16)} color="var(--text-secondary)" />
        <span style={{ color: 'var(--text-secondary)' }}>Settings</span>
      </button>
    </div>
  );
}
