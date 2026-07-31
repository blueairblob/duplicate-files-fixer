import React, { useState } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { getTheme, applyTheme } from '../utils/theme.js';

const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light',  label: 'Light' },
  { id: 'dark',   label: 'Dark' },
];

export default function SettingsView() {
  const { scale } = useDPR();
  const [theme, setTheme] = useState(getTheme());

  const pick = (id) => {
    setTheme(id);
    applyTheme(id);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: scale(680), margin: '0 auto', padding: `${scale(28)}px ${scale(32)}px` }}>
        <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 500, marginBottom: scale(4) }}>Settings</h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', marginBottom: scale(24) }}>
          App preferences.
        </p>

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(16)}px`,
          display: 'flex', alignItems: 'center', gap: scale(12),
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 'var(--fs-secondary)', fontWeight: 500, margin: 0 }}>Appearance</p>
            <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', margin: `${scale(1)}px 0 0` }}>
              System follows your OS setting
            </p>
          </div>
          <div style={{
            display: 'inline-flex', background: 'var(--bg-inset)',
            borderRadius: 'var(--radius-sm)', padding: scale(3),
          }}>
            {THEMES.map(({ id, label }) => {
              const active = theme === id;
              return (
                <button key={id} onClick={() => pick(id)} style={{
                  padding: `${scale(5)}px ${scale(13)}px`,
                  fontSize: 'var(--fs-caption)', fontWeight: active ? 500 : 400,
                  background: active ? 'var(--bg-card)' : 'transparent',
                  border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
                  borderRadius: scale(6),
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: active ? 'var(--shadow-card)' : 'none',
                }}>{label}</button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
