import React, { useEffect, useState } from 'react';

const api = window.electronAPI;

// Demo defaults when running outside Electron (mirrors src/main/exclusions.js)
const DEMO_DEFAULTS = [
  'node_modules', '.git', '.svn', '.hg',
  'System Volume Information', '$RECYCLE.BIN', 'Windows',
  'OneDriveTemp', '.dropbox.cache', '.dff-quarantine',
  '.DS_Store', '.Spotlight-V100', '.Trashes', '.fseventsd',
  '__pycache__', '.cache',
];

export default function ExclusionListPanel() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const [newEntry, setNewEntry] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (!api) {
      setList(DEMO_DEFAULTS);
      setLoading(false);
      return;
    }
    api.getExclusions().then(l => {
      setList(l);
      setLoading(false);
    });
  }, [open]);

  const persist = async (next) => {
    setList(next);
    if (api) await api.setExclusions(next);
  };

  const addEntry = () => {
    const trimmed = newEntry.trim();
    if (!trimmed || list.includes(trimmed)) return;
    persist([...list, trimmed]);
    setNewEntry('');
  };

  const removeEntry = (entry) => {
    persist(list.filter(e => e !== entry));
  };

  const resetDefaults = async () => {
    if (api) {
      const defaults = await api.resetExclusions();
      setList(defaults);
    } else {
      setList(DEMO_DEFAULTS);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14 }}>🚫</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Exclusion list</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {open ? '' : `${list.length || ''} ${list.length ? 'patterns' : 'folders & patterns to skip'}`}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 'auto' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Folders, files, or patterns (use <code style={{ fontFamily: 'var(--font-mono)' }}>*</code> as a wildcard) that are skipped during scanning.
            Pre-populated with sensible defaults for dev tooling, system folders, and cloud sync caches.
          </p>

          {loading ? (
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input
                  value={newEntry}
                  onChange={e => setNewEntry(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addEntry()}
                  placeholder="e.g. *.tmp or my-folder-name"
                  style={{
                    flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                    padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
                  }}
                />
                <button onClick={addEntry} style={btnSm}>+ Add</button>
                <button onClick={resetDefaults} style={{ ...btnSm, color: 'var(--text-muted)' }}>Reset defaults</button>
              </div>

              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6,
                maxHeight: 160, overflowY: 'auto', padding: '2px 0',
              }}>
                {list.map(entry => (
                  <span key={entry} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: '4px 8px',
                    fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                  }}>
                    {entry}
                    <button
                      onClick={() => removeEntry(entry)}
                      style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}
                    >✕</button>
                  </span>
                ))}
                {list.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No exclusions — everything will be scanned.</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const btnSm = {
  background: 'var(--bg-surface)', color: 'var(--teal)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  padding: '6px 12px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
};
