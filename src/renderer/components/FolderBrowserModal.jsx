/**
 * LocationsPanel — a compact quick-jump popover showing drives and common
 * folders. Clicking a location opens the native OS folder picker seeded to
 * that path (via dialog:openFolder).  No custom folder tree needed — the OS
 * picker handles all browsing natively, giving users the familiar Windows
 * Explorer / Finder / GTK experience on every platform.
 *
 * Props:
 *   title      string  — heading shown at the top of the panel
 *   accent     string  — CSS colour for the active-indicator dot
 *   onConfirm  fn(path) — called with each selected path (may be called
 *                         multiple times if user selects several folders)
 *   onClose    fn()    — called when the panel is dismissed
 */
import React, { useEffect, useState } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';

const api = window.electronAPI;

const ICON_MAP = {
  home:      '🏠',
  desktop:   '🖥',
  documents: '📁',
  downloads: '⬇',
  pictures:  '🖼',
  music:     '🎵',
  videos:    '🎬',
  hdd:       '💾',
  usb:       '🔌',
  network:   '🌐',
  disc:      '💿',
  drive:     '🗄',
};

const GROUP_ORDER  = ['Quick access', 'Local drives', 'Removable', 'Network'];
const GROUP_ICONS  = {
  'Quick access': ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'],
  'Local drives': ['hdd', 'drive', 'disc'],
  'Removable':    ['usb'],
  'Network':      ['network'],
};

// Shown when running in the browser (Vite dev server) without Electron
const DEMO_LOCATIONS = [
  { label: 'Home',                         path: 'C:\\Users\\Demo',            icon: 'home'      },
  { label: 'Documents',                    path: 'C:\\Users\\Demo\\Documents', icon: 'documents' },
  { label: 'Downloads',                    path: 'C:\\Users\\Demo\\Downloads', icon: 'downloads' },
  { label: 'Pictures',                     path: 'C:\\Users\\Demo\\Pictures',  icon: 'pictures'  },
  { label: 'Local Disk (C:) — 412.0 GB',  path: 'C:\\',                       icon: 'hdd'       },
  { label: 'Data (D:) — 931.0 GB',         path: 'D:\\',                       icon: 'hdd'       },
  { label: '\\\\NAS\\Shared (Z:)',          path: 'Z:\\',                       icon: 'network'   },
  { label: 'USB Drive (E:)',               path: 'E:\\',                       icon: 'usb'       },
];

export default function FolderBrowserModal({ title, accent, onConfirm, onClose }) {
  const { scale } = useDPR();
  const [locations, setLocations]         = useState([]);
  const [loadingLocations, setLoading]    = useState(true);
  const [openingPath, setOpeningPath]     = useState(null); // which row is mid-flight

  useEffect(() => {
    if (!api) {
      setLocations(DEMO_LOCATIONS);
      setLoading(false);
      return;
    }
    api.getLocations().then(locs => {
      setLocations(locs);
      setLoading(false);
    });
  }, []);

  /**
   * Open the native OS folder picker, optionally seeded to `seedPath`.
   * Calls onConfirm for every folder the user selects, then closes.
   */
  const openNativePicker = async (seedPath) => {
    if (!api) {
      // In browser-only mode just confirm the seed path directly (demo)
      onConfirm(seedPath || '/demo/path');
      onClose();
      return;
    }
    setOpeningPath(seedPath || '__root__');
    try {
      const paths = await api.openFolder(seedPath || undefined);
      if (paths && paths.length > 0) {
        paths.forEach(p => onConfirm(p));
        onClose();
      }
    } finally {
      setOpeningPath(null);
    }
  };

  const groups = GROUP_ORDER
    .map(name => ({
      name,
      items: locations.filter(l => GROUP_ICONS[name].includes(l.icon)),
    }))
    .filter(g => g.items.length > 0);

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          width: 300,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: `${scale(12)}px ${scale(16)}px`,
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: scale(10),
        }}>
          <div style={{ width: scale(8), height: scale(8), borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <span style={{ fontSize: scale(13), fontWeight: 600, flex: 1 }}>{title || 'Choose a folder'}</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', fontSize: scale(15),
              cursor: 'pointer', padding: `0 ${scale(4)}px`, lineHeight: 1,
            }}
          >✕</button>
        </div>

        {/* Quick-jump hint */}
        <div style={{
          padding: `${scale(8)}px ${scale(16)}px`,
          fontSize: scale(10), color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}>
          Click a location to open it in your system's folder browser
        </div>

        {/* Locations list */}
        <div style={{ overflowY: 'auto', maxHeight: 380, padding: `${scale(8)}px 0` }}>
          {loadingLocations ? (
            <div style={{ padding: scale(20), fontSize: scale(12), color: 'var(--text-muted)', textAlign: 'center' }}>
              Loading…
            </div>
          ) : (
            groups.map(({ name, items }) => (
              <div key={name} style={{ marginBottom: scale(4) }}>
                <div style={{
                  padding: `${scale(4)}px ${scale(16)}px`,
                  fontSize: scale(9), fontWeight: 700,
                  color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>{name}</div>
                {items.map(loc => {
                  const isOpening = openingPath === loc.path;
                  return (
                    <button
                      key={loc.path}
                      onClick={() => openNativePicker(loc.path)}
                      disabled={!!openingPath}
                      style={{
                        display: 'flex', alignItems: 'center', gap: scale(10),
                        width: '100%', padding: `${scale(7)}px ${scale(16)}px`,
                        background: isOpening ? 'var(--bg-hover)' : 'transparent',
                        border: 'none', cursor: openingPath ? 'wait' : 'pointer',
                        textAlign: 'left', opacity: openingPath && !isOpening ? 0.5 : 1,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!openingPath) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={e => { if (!openingPath) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ fontSize: scale(13), width: scale(18), textAlign: 'center', flexShrink: 0 }}>
                        {isOpening ? '⏳' : (ICON_MAP[loc.icon] || '📁')}
                      </span>
                      <span style={{
                        fontSize: scale(11.5), color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
                      }}>{loc.label}</span>
                      <span style={{ fontSize: scale(10), color: 'var(--text-muted)', flexShrink: 0 }}>›</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer — open picker from scratch (no seed path) */}
        <div style={{
          padding: `${scale(10)}px ${scale(16)}px`,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}>
          <button
            onClick={() => openNativePicker(null)}
            disabled={!!openingPath}
            style={{
              width: '100%',
              background: accent, color: '#0d0f14',
              border: 'none', borderRadius: 'var(--radius-sm)',
              padding: `${scale(8)}px ${scale(14)}px`,
              fontSize: scale(12), fontWeight: 600,
              cursor: openingPath ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: scale(6),
            }}
          >
            📂 Browse…
          </button>
        </div>
      </div>
    </div>
  );
}
