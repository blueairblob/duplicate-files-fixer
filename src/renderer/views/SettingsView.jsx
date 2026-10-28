import React, { useState, useEffect, useCallback } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { getTheme, applyTheme } from '../utils/theme.js';
import { setLegacyScaling } from '../hooks/useDPR.js';

const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light',  label: 'Light' },
  { id: 'dark',   label: 'Dark' },
];

export default function SettingsView() {
  const { scale, legacyScaling, dpr } = useDPR();
  const [theme, setTheme] = useState(getTheme());
  const [cache, setCache] = useState(null);
  const [clearing, setClearing] = useState(false);

  const api = window.electronAPI;
  const refreshCache = useCallback(async () => {
    if (!api?.getCacheInfo) return;
    try { setCache(await api.getCacheInfo()); } catch { setCache(null); }
  }, [api]);
  useEffect(() => { refreshCache(); }, [refreshCache]);

  const clearCache = async () => {
    if (!api?.clearCache) return;
    setClearing(true);
    try { await api.clearCache(); await refreshCache(); } finally { setClearing(false); }
  };

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

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(16)}px`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: scale(16), marginTop: scale(12),
        }}>
          <div style={{ minWidth: 0 }}>
            <p id="legacy-scaling-label" style={{ fontSize: 'var(--fs-secondary)', fontWeight: 500, margin: 0 }}>Smaller text on high-resolution screens</p>
            <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', margin: `${scale(1)}px 0 0` }}>
              Off: the system scales the app like any other (recommended). On: the app's older,
              more compact sizing{dpr > 1 ? ` — this screen is at ${Math.round(dpr * 100)}%` : ''}.
            </p>
          </div>
          <button role="switch" aria-checked={legacyScaling} aria-labelledby="legacy-scaling-label"
            onClick={() => setLegacyScaling(!legacyScaling)}
            style={{
              width: scale(38), height: scale(22), borderRadius: scale(11), flexShrink: 0, padding: scale(2),
              background: legacyScaling ? 'var(--accent)' : 'var(--bg-inset)',
              border: '1px solid var(--border)', display: 'flex', justifyContent: legacyScaling ? 'flex-end' : 'flex-start',
            }}>
            <span style={{ width: scale(16), height: scale(16), borderRadius: '50%', background: '#fff', boxShadow: 'var(--shadow-card)' }} />
          </button>
        </div>

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(16)}px`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: scale(16), marginTop: scale(12),
        }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 'var(--fs-secondary)', fontWeight: 500, margin: 0 }}>Scan cache</p>
            <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', margin: `${scale(1)}px 0 0` }}>
              {cache?.exists
                ? `${cache.entries != null ? cache.entries.toLocaleString() + ' files remembered' : 'Files remembered'} · repeat scans skip re-reading them`
                : 'Empty — the next scan will read every file'}
            </p>
          </div>
          <button onClick={clearCache} disabled={clearing || !cache?.exists} style={{
            padding: `${scale(6)}px ${scale(14)}px`, fontSize: 'var(--fs-caption)',
            background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)', flexShrink: 0,
            color: cache?.exists ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: cache?.exists && !clearing ? 'pointer' : 'default',
          }}>{clearing ? 'Clearing…' : 'Clear cache'}</button>
        </div>

      </div>
    </div>
  );
}
