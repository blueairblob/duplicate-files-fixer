import React, { useEffect, useState } from 'react';

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

export default function LocationPicker({ onSelect }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) {
      // Demo locations
      setLocations([
        { label: 'Home',        path: 'C:\\Users\\Demo',              icon: 'home' },
        { label: 'Documents',   path: 'C:\\Users\\Demo\\Documents',   icon: 'documents' },
        { label: 'Downloads',   path: 'C:\\Users\\Demo\\Downloads',   icon: 'downloads' },
        { label: 'Pictures',    path: 'C:\\Users\\Demo\\Pictures',    icon: 'pictures' },
        { label: 'C:\\ (System Drive)', path: 'C:\\',                icon: 'hdd' },
        { label: 'D:\\ (Data)',         path: 'D:\\',                icon: 'hdd' },
        { label: 'Network: \\\\NAS\\Shared', path: 'Z:\\',           icon: 'network' },
        { label: 'USB Drive (E:\\)',     path: 'E:\\',                icon: 'usb' },
      ]);
      setLoading(false);
      return;
    }
    api.getLocations().then(locs => {
      setLocations(locs);
      setLoading(false);
    });
  }, []);

  const groups = {
    'Quick access': locations.filter(l => ['home','desktop','documents','downloads','pictures','music','videos'].includes(l.icon)),
    'Drives':       locations.filter(l => ['hdd','drive','disc'].includes(l.icon)),
    'Removable':    locations.filter(l => l.icon === 'usb'),
    'Network':      locations.filter(l => l.icon === 'network'),
  };

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      maxHeight: 280,
      overflowY: 'auto',
    }}>
      {loading ? (
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
          Loading locations…
        </div>
      ) : (
        Object.entries(groups).map(([groupName, items]) => {
          if (items.length === 0) return null;
          return (
            <div key={groupName}>
              <div style={{
                padding: '6px 12px',
                fontSize: 9, fontWeight: 700,
                color: 'var(--text-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: 'var(--bg-base)',
                borderBottom: '1px solid var(--border)',
              }}>{groupName}</div>
              {items.map(loc => (
                <button
                  key={loc.path}
                  onClick={() => onSelect(loc.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 12px',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>
                    {ICON_MAP[loc.icon] || '📁'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {loc.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {loc.path}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>+</span>
                </button>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
