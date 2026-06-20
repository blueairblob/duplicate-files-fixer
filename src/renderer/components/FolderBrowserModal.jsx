import React, { useEffect, useState, useCallback } from 'react';

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

const GROUP_ORDER = ['Quick access', 'Local drives', 'Removable', 'Network'];
const GROUP_ICONS = {
  'Quick access': ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'],
  'Local drives': ['hdd', 'drive', 'disc'],
  'Removable':    ['usb'],
  'Network':      ['network'],
};

// Demo data for running outside Electron
const DEMO_LOCATIONS = [
  { label: 'Home',        path: 'C:\\Users\\Demo',              icon: 'home' },
  { label: 'Documents',   path: 'C:\\Users\\Demo\\Documents',   icon: 'documents' },
  { label: 'Downloads',   path: 'C:\\Users\\Demo\\Downloads',   icon: 'downloads' },
  { label: 'Pictures',    path: 'C:\\Users\\Demo\\Pictures',    icon: 'pictures' },
  { label: 'Local Disk (C:) — 412.0 GB', path: 'C:\\',          icon: 'hdd' },
  { label: 'Data (D:) — 931.0 GB',       path: 'D:\\',          icon: 'hdd' },
  { label: '\\\\NAS\\Shared (Z:)', path: 'Z:\\',                icon: 'network' },
  { label: 'USB Drive (E:\\)',     path: 'E:\\',                icon: 'usb' },
];

const DEMO_TREE = {
  'C:\\Users\\Demo': [
    { name: 'Desktop', path: 'C:\\Users\\Demo\\Desktop', subfolderCount: 0 },
    { name: 'Documents', path: 'C:\\Users\\Demo\\Documents', subfolderCount: 4 },
    { name: 'Downloads', path: 'C:\\Users\\Demo\\Downloads', subfolderCount: 12 },
    { name: 'Pictures', path: 'C:\\Users\\Demo\\Pictures', subfolderCount: 3 },
  ],
  'C:\\Users\\Demo\\Documents': [
    { name: 'Work', path: 'C:\\Users\\Demo\\Documents\\Work', subfolderCount: 6 },
    { name: 'Personal', path: 'C:\\Users\\Demo\\Documents\\Personal', subfolderCount: 2 },
  ],
};

function getDemoChildren(p) {
  return DEMO_TREE[p] || [];
}

// Split a path into breadcrumb segments, handling both \ and / separators
function pathToBreadcrumbs(p) {
  if (!p) return [];
  const isWindows = /^[A-Za-z]:\\/.test(p);
  const sep = isWindows ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);

  if (isWindows) {
    // First segment is the drive letter, e.g. "C:"
    let acc = parts[0] + '\\';
    const crumbs = [{ label: parts[0] + '\\', path: acc }];
    for (let i = 1; i < parts.length; i++) {
      acc = acc + parts[i] + '\\';
      crumbs.push({ label: parts[i], path: acc.slice(0, -1) });
    }
    return crumbs;
  } else {
    let acc = '';
    const crumbs = [{ label: '/', path: '/' }];
    for (const part of parts) {
      acc = acc + '/' + part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }
}

function parentOf(p) {
  const crumbs = pathToBreadcrumbs(p);
  if (crumbs.length <= 1) return null;
  return crumbs[crumbs.length - 2].path;
}

export default function FolderBrowserModal({ title, accent, onConfirm, onClose }) {
  const [locations, setLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  const [currentPath, setCurrentPath] = useState(null);
  const [folders, setFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [dirError, setDirError] = useState(null);

  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedSubcount, setSelectedSubcount] = useState(null);

  // Load the locations sidebar once on mount
  useEffect(() => {
    if (!api) {
      setLocations(DEMO_LOCATIONS);
      setLoadingLocations(false);
      return;
    }
    api.getLocations().then(locs => {
      setLocations(locs);
      setLoadingLocations(false);
    });
  }, []);

  const loadDirectory = useCallback(async (dirPath) => {
    setLoadingFolders(true);
    setDirError(null);
    setCurrentPath(dirPath);

    if (!api) {
      setFolders(getDemoChildren(dirPath));
      setLoadingFolders(false);
      return;
    }

    const result = await api.listDirectory(dirPath);
    if (result.success) {
      setFolders(result.folders);
    } else {
      setFolders([]);
      setDirError(result.error);
    }
    setLoadingFolders(false);
  }, []);

  const handleSelectLocation = (loc) => {
    setSelectedPath(loc.path);
    setSelectedSubcount(null);
    loadDirectory(loc.path);
  };

  const handleDrillInto = (folder) => {
    setSelectedPath(folder.path);
    setSelectedSubcount(folder.subfolderCount);
    loadDirectory(folder.path);
  };

  const handleBack = () => {
    const parent = parentOf(currentPath);
    if (parent) loadDirectory(parent);
  };

  const handleBreadcrumbClick = (crumbPath) => {
    loadDirectory(crumbPath);
  };

  const breadcrumbs = currentPath ? pathToBreadcrumbs(currentPath) : [];

  const groups = GROUP_ORDER.map(name => ({
    name,
    items: locations.filter(l => GROUP_ICONS[name].includes(l.icon)),
  })).filter(g => g.items.length > 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          width: 820, height: 520,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title || 'Choose a folder'}</span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', padding: '0 4px',
            }}
          >✕</button>
        </div>

        {/* Three-panel body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── Left panel: locations sidebar ── */}
          <div style={{
            width: 200, flexShrink: 0,
            borderRight: '1px solid var(--border)',
            overflowY: 'auto', padding: '10px 0',
            background: 'var(--bg-surface)',
          }}>
            {loadingLocations ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
            ) : (
              groups.map(({ name, items }) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{
                    padding: '4px 14px', fontSize: 9, fontWeight: 700,
                    color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>{name}</div>
                  {items.map(loc => (
                    <button
                      key={loc.path}
                      onClick={() => handleSelectLocation(loc)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '6px 14px',
                        background: selectedPath === loc.path || currentPath === loc.path ? 'var(--bg-hover)' : 'transparent',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                      }}
                      onMouseEnter={e => { if (currentPath !== loc.path) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={e => { if (currentPath !== loc.path) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0 }}>
                        {ICON_MAP[loc.icon] || '📁'}
                      </span>
                      <span style={{
                        fontSize: 11.5, color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{loc.label}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* ── Centre panel: live folder tree ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {currentPath ? (
              <>
                {/* Breadcrumb + back */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  flexShrink: 0, overflowX: 'auto',
                }}>
                  <button
                    onClick={handleBack}
                    disabled={!parentOf(currentPath)}
                    style={{
                      background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
                      width: 24, height: 24, flexShrink: 0, cursor: parentOf(currentPath) ? 'pointer' : 'default',
                      opacity: parentOf(currentPath) ? 1 : 0.3,
                      fontSize: 12,
                    }}
                  >←</button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap' }}>
                    {breadcrumbs.map((crumb, i) => (
                      <React.Fragment key={crumb.path}>
                        {i > 0 && <span style={{ color: 'var(--text-muted)' }}>/</span>}
                        <button
                          onClick={() => handleBreadcrumbClick(crumb.path)}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: i === breadcrumbs.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
                            fontFamily: 'var(--font-mono)', padding: '2px 4px',
                          }}
                        >{crumb.label}</button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Folder list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
                  {loadingFolders ? (
                    <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
                  ) : dirError ? (
                    <div style={{ padding: 20, fontSize: 12, color: 'var(--amber)', textAlign: 'center' }}>⚠ {dirError}</div>
                  ) : folders.length === 0 ? (
                    <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No subfolders here</div>
                  ) : (
                    folders.map(folder => (
                      <button
                        key={folder.path}
                        onDoubleClick={() => handleDrillInto(folder)}
                        onClick={() => { setSelectedPath(folder.path); setSelectedSubcount(folder.subfolderCount); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          width: '100%', padding: '8px 16px',
                          background: selectedPath === folder.path ? 'var(--teal-dim)' : 'transparent',
                          border: 'none', cursor: 'pointer', textAlign: 'left',
                        }}
                        onMouseEnter={e => { if (selectedPath !== folder.path) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { if (selectedPath !== folder.path) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ fontSize: 14 }}>📁</span>
                        <span style={{
                          flex: 1, fontSize: 12.5,
                          color: selectedPath === folder.path ? 'var(--teal)' : 'var(--text-primary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{folder.name}</span>
                        {folder.subfolderCount > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                            {folder.subfolderCount} subfolder{folder.subfolderCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        <span
                          onClick={(e) => { e.stopPropagation(); handleDrillInto(folder); }}
                          style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, padding: '0 4px' }}
                        >▸</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 20,
              }}>
                Choose a location on the left to start browsing
              </div>
            )}
          </div>

          {/* ── Right panel: selection confirmation ── */}
          <div style={{
            width: 220, flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
            background: 'var(--bg-surface)',
          }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Selected folder
              </p>
              {selectedPath ? (
                <div style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)',
                    wordBreak: 'break-all', lineHeight: 1.5,
                  }}>{selectedPath}</div>
                  {selectedSubcount != null && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                      {selectedSubcount} subfolder{selectedSubcount !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nothing selected yet</p>
              )}
            </div>

            <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Double-click a folder to open it. Single-click to select it for scanning.
            </p>

            <button
              onClick={() => selectedPath && onConfirm(selectedPath)}
              disabled={!selectedPath}
              style={{
                marginTop: 'auto',
                background: selectedPath ? accent : 'var(--bg-elevated)',
                color: selectedPath ? '#0d0f14' : 'var(--text-muted)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '10px 14px', fontSize: 12, fontWeight: 600,
                cursor: selectedPath ? 'pointer' : 'not-allowed',
              }}
            >
              + Add folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
